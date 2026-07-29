import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { spawn } from 'node:child_process'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

export type SpreadsheetSheetStructure = {
  name: string
  rowCount: number
  columnCount: number
  indexedRows: number
  indexedCells: number
  headers: string[]
  truncated: boolean
}

export type SpreadsheetAttachmentStructure = {
  kind: 'spreadsheet'
  sheetCount: number
  indexedSheetCount: number
  indexedCells: number
  truncated: boolean
  sheets: SpreadsheetSheetStructure[]
}

export type AttachmentTextResult = {
  success: boolean
  text: string
  format: string
  status: 'indexed' | 'unsupported' | 'too_large' | 'empty' | 'ocr_required' | 'dependency_missing' | 'failed'
  error?: string
  structure?: SpreadsheetAttachmentStructure
}

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 16_000
const MAX_SPREADSHEET_SHEETS = 20
const MAX_SPREADSHEET_ROWS_PER_SHEET = 500
const MAX_SPREADSHEET_CELLS = 8_000
const MAX_SPREADSHEET_CELL_CHARS = 500
const PLAIN_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml',
  '.html', '.htm', '.log', '.yaml', '.yml', '.ini', '.conf'
])

function decodeXmlText(value: string): string {
  return value
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<a:br\/>/g, '\n')
    .replace(/<\/w:p>|<\/a:p>|<\/row>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
}

async function extractOfficeXml(buffer: Buffer, extension: string): Promise<string> {
  const archive = await JSZip.loadAsync(buffer)
  const names = Object.keys(archive.files).filter(name => {
    if (extension === '.docx') return /^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(name)
    if (extension === '.pptx') return /^ppt\/slides\/slide\d+\.xml$/i.test(name)
    return /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name)
  }).sort()
  const parts: string[] = []
  for (const name of names.slice(0, 80)) {
    const xml = await archive.file(name)?.async('string')
    if (xml) parts.push(decodeXmlText(xml))
    if (parts.join('\n').length >= MAX_TEXT_CHARS) break
  }
  return normalizeText(parts.join('\n'))
}

function spreadsheetCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return String(Number(value.toPrecision(15)))
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      const formula = String(('formula' in value ? value.formula : value.sharedFormula) || '').trim()
      const result = spreadsheetCellText(value.result as ExcelJS.CellValue)
      return result ? `${result}（公式：${formula}）` : `公式：${formula}`
    }
    if ('hyperlink' in value) {
      const text = String(value.text || '').trim()
      const hyperlink = String(value.hyperlink || '').trim()
      return text && text !== hyperlink ? `${text}（${hyperlink}）` : hyperlink
    }
    if ('richText' in value) return value.richText.map(part => part.text).join('')
    if ('error' in value) return String(value.error || '')
  }
  return String(value)
}

function spreadsheetColumnLabel(column: number): string {
  let current = column
  let label = ''
  while (current > 0) {
    current -= 1
    label = String.fromCharCode(65 + (current % 26)) + label
    current = Math.floor(current / 26)
  }
  return label
}

function safeSpreadsheetLabel(value: string, fallback: string): string {
  const label = normalizeText(value).replace(/\n/g, ' ').slice(0, 80)
  return label || fallback
}

function xmlAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return match ? decodeXmlText(match[1]).trim() : ''
}

function spreadsheetColumnNumber(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
}

function excelSerialDate(value: number): string {
  const timestamp = Date.UTC(1899, 11, 30) + value * 86_400_000
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

async function extractSpreadsheetXmlFallback(buffer: Buffer): Promise<AttachmentTextResult> {
  const archive = await JSZip.loadAsync(buffer)
  const workbookXml = await archive.file('xl/workbook.xml')?.async('string') || ''
  const relationshipsXml = await archive.file('xl/_rels/workbook.xml.rels')?.async('string') || ''
  const sharedStringsXml = await archive.file('xl/sharedStrings.xml')?.async('string') || ''
  const stylesXml = await archive.file('xl/styles.xml')?.async('string') || ''
  const sharedStrings = [...sharedStringsXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)]
    .map(match => normalizeText(decodeXmlText(match[1])))
  const relationships = new Map(
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?>/gi)].map(match => [
      xmlAttribute(match[0], 'Id'),
      xmlAttribute(match[0], 'Target').replace(/^\/?xl\//, '')
    ])
  )
  const customDateFormatIds = new Set(
    [...stylesXml.matchAll(/<(?:\w+:)?numFmt\b[^>]*\/?>/gi)]
      .filter(match => /[ymdhis]/i.test(xmlAttribute(match[0], 'formatCode').replace(/\[[^\]]+\]/g, '')))
      .map(match => Number(xmlAttribute(match[0], 'numFmtId')))
      .filter(Number.isFinite)
  )
  const builtInDateFormatIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
  const cellXfsXml = stylesXml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/i)?.[1] || ''
  const dateStyleIndexes = new Set(
    [...cellXfsXml.matchAll(/<(?:\w+:)?xf\b[^>]*\/?>/gi)]
      .map((match, index) => ({ index, numberFormat: Number(xmlAttribute(match[0], 'numFmtId')) }))
      .filter(item => builtInDateFormatIds.has(item.numberFormat) || customDateFormatIds.has(item.numberFormat))
      .map(item => item.index)
  )
  const sheetDescriptors = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/gi)].map(match => ({
    name: xmlAttribute(match[0], 'name') || '未命名工作表',
    path: relationships.get(xmlAttribute(match[0], 'r:id')) || ''
  }))
  const output: string[] = []
  const sheets: SpreadsheetSheetStructure[] = []
  let indexedCells = 0
  let truncated = sheetDescriptors.length > MAX_SPREADSHEET_SHEETS

  for (const descriptor of sheetDescriptors.slice(0, MAX_SPREADSHEET_SHEETS)) {
    if (!descriptor.path || indexedCells >= MAX_SPREADSHEET_CELLS) {
      truncated = true
      continue
    }
    const normalizedPath = descriptor.path.startsWith('worksheets/') ? `xl/${descriptor.path}` : `xl/${descriptor.path.replace(/^\/+/, '')}`
    const worksheetXml = await archive.file(normalizedPath)?.async('string') || ''
    const rowMatches = [...worksheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)]
    const sheet: SpreadsheetSheetStructure = {
      name: descriptor.name,
      rowCount: rowMatches.length,
      columnCount: 0,
      indexedRows: 0,
      indexedCells: 0,
      headers: [],
      truncated: rowMatches.length > MAX_SPREADSHEET_ROWS_PER_SHEET
    }
    const lines = [`[工作表：${descriptor.name}]`]
    const headers = new Map<number, string>()
    for (const rowMatch of rowMatches.slice(0, MAX_SPREADSHEET_ROWS_PER_SHEET)) {
      if (indexedCells >= MAX_SPREADSHEET_CELLS || output.join('\n').length + lines.join('\n').length >= MAX_TEXT_CHARS) {
        sheet.truncated = true
        truncated = true
        break
      }
      const rowNumber = Number(xmlAttribute(rowMatch[0], 'r')) || sheet.indexedRows + 1
      const cells: Array<{ column: number, value: string }> = []
      for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi)) {
        if (indexedCells + cells.length >= MAX_SPREADSHEET_CELLS) break
        const cellTag = `<c ${cellMatch[1]}>`
        const column = spreadsheetColumnNumber(xmlAttribute(cellTag, 'r'))
        if (!column) continue
        const type = xmlAttribute(cellTag, 't')
        const styleIndex = Number(xmlAttribute(cellTag, 's'))
        const cellBody = cellMatch[2] || ''
        const rawValue = cellBody.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1] || ''
        const formula = normalizeText(decodeXmlText(cellBody.match(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/i)?.[1] || ''))
        let value = type === 's'
          ? sharedStrings[Number(rawValue)] || ''
          : type === 'inlineStr'
            ? normalizeText(decodeXmlText(cellBody))
            : normalizeText(decodeXmlText(rawValue))
        if (type === 'n' && value && Number.isFinite(Number(value))) value = String(Number(Number(value).toPrecision(15)))
        if (type === 'n' && value && dateStyleIndexes.has(styleIndex)) value = excelSerialDate(Number(value))
        if (formula) value = value ? `${value}（公式：${formula}）` : `公式：${formula}`
        value = value.slice(0, MAX_SPREADSHEET_CELL_CHARS)
        if (value) cells.push({ column, value })
      }
      if (!cells.length) continue
      sheet.columnCount = Math.max(sheet.columnCount, ...cells.map(cell => cell.column))
      if (!sheet.indexedRows) {
        for (const cell of cells) headers.set(cell.column, safeSpreadsheetLabel(cell.value, spreadsheetColumnLabel(cell.column)))
        sheet.headers = cells.map(cell => safeSpreadsheetLabel(cell.value, spreadsheetColumnLabel(cell.column)))
        lines.push(`表头（第 ${rowNumber} 行）：${cells.map(cell => `${spreadsheetColumnLabel(cell.column)}=${cell.value}`).join(' | ')}`)
      } else {
        lines.push(`第 ${rowNumber} 行：${cells.map(cell => `${headers.get(cell.column) || spreadsheetColumnLabel(cell.column)}=${cell.value}`).join(' | ')}`)
      }
      sheet.indexedRows += 1
      sheet.indexedCells += cells.length
      indexedCells += cells.length
    }
    if (sheet.truncated) truncated = true
    sheets.push(sheet)
    output.push(lines.join('\n'))
  }
  const text = normalizeText(output.join('\n\n'))
  const structure: SpreadsheetAttachmentStructure = {
    kind: 'spreadsheet',
    sheetCount: sheetDescriptors.length,
    indexedSheetCount: sheets.length,
    indexedCells,
    truncated,
    sheets
  }
  return text
    ? { success: true, text, format: '.xlsx', status: 'indexed', structure }
    : { success: false, text: '', format: '.xlsx', status: 'empty', structure }
}

async function extractSpreadsheet(buffer: Buffer): Promise<AttachmentTextResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    return extractSpreadsheetXmlFallback(buffer)
  }
  const output: string[] = []
  const sheets: SpreadsheetSheetStructure[] = []
  let indexedCells = 0
  let truncated = workbook.worksheets.length > MAX_SPREADSHEET_SHEETS

  for (const worksheet of workbook.worksheets.slice(0, MAX_SPREADSHEET_SHEETS)) {
    if (indexedCells >= MAX_SPREADSHEET_CELLS || output.join('\n').length >= MAX_TEXT_CHARS) {
      truncated = true
      break
    }
    const actualRows = worksheet.actualRowCount || worksheet.rowCount
    const actualColumns = worksheet.actualColumnCount || worksheet.columnCount
    const sheet: SpreadsheetSheetStructure = {
      name: worksheet.name,
      rowCount: actualRows,
      columnCount: actualColumns,
      indexedRows: 0,
      indexedCells: 0,
      headers: [],
      truncated: actualRows > MAX_SPREADSHEET_ROWS_PER_SHEET
    }
    const lines: string[] = [`[工作表：${worksheet.name}]`]
    let headerRowNumber = 0
    const headers = new Map<number, string>()

    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, MAX_SPREADSHEET_ROWS_PER_SHEET); rowNumber += 1) {
      if (indexedCells >= MAX_SPREADSHEET_CELLS || output.join('\n').length + lines.join('\n').length >= MAX_TEXT_CHARS) {
        sheet.truncated = true
        truncated = true
        break
      }
      const row = worksheet.getRow(rowNumber)
      const cells: Array<{ column: number, value: string }> = []
      row.eachCell({ includeEmpty: false }, cell => {
        if (indexedCells + cells.length >= MAX_SPREADSHEET_CELLS) return
        if (cell.isMerged && cell.address !== cell.master.address) return
        const value = normalizeText(spreadsheetCellText(cell.value)).slice(0, MAX_SPREADSHEET_CELL_CHARS)
        if (value) cells.push({ column: cell.col, value })
      })
      if (!cells.length) continue
      if (!headerRowNumber) {
        headerRowNumber = rowNumber
        for (const cell of cells) headers.set(cell.column, safeSpreadsheetLabel(cell.value, spreadsheetColumnLabel(cell.column)))
        sheet.headers = cells.map(cell => safeSpreadsheetLabel(cell.value, spreadsheetColumnLabel(cell.column)))
        lines.push(`表头（第 ${rowNumber} 行）：${cells.map(cell => `${spreadsheetColumnLabel(cell.column)}=${cell.value}`).join(' | ')}`)
      } else {
        const values = cells.map(cell => {
          const label = headers.get(cell.column) || spreadsheetColumnLabel(cell.column)
          return `${label}=${cell.value}`
        })
        lines.push(`第 ${rowNumber} 行：${values.join(' | ')}`)
      }
      sheet.indexedRows += 1
      sheet.indexedCells += cells.length
      indexedCells += cells.length
    }
    if (sheet.truncated) truncated = true
    sheets.push(sheet)
    output.push(lines.join('\n'))
  }

  const text = normalizeText(output.join('\n\n'))
  const structure: SpreadsheetAttachmentStructure = {
    kind: 'spreadsheet',
    sheetCount: workbook.worksheets.length,
    indexedSheetCount: sheets.length,
    indexedCells,
    truncated,
    sheets
  }
  return text
    ? { success: true, text, format: '.xlsx', status: 'indexed', structure }
    : { success: false, text: '', format: '.xlsx', status: 'empty', structure }
}

function resolvePdfTextBinary(): string {
  return ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext', '/usr/bin/pdftotext']
    .find(existsSync) || ''
}

async function extractPdfText(filePath: string): Promise<AttachmentTextResult> {
  const binary = resolvePdfTextBinary()
  if (!binary) return { success: false, text: '', format: '.pdf', status: 'dependency_missing' }
  return new Promise(resolve => {
    const child = spawn(binary, ['-layout', '-nopgbrk', filePath, '-'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (result: AttachmentTextResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ success: false, text: '', format: '.pdf', status: 'failed', error: 'timeout' })
    }, 10_000)
    child.stdout.on('data', chunk => {
      total += chunk.length
      if (total > 256 * 1024) {
        child.kill('SIGKILL')
        finish({ success: false, text: '', format: '.pdf', status: 'too_large' })
      } else {
        chunks.push(Buffer.from(chunk))
      }
    })
    child.on('error', error => finish({ success: false, text: '', format: '.pdf', status: 'failed', error: error.message }))
    child.on('close', code => {
      if (settled) return
      if (code !== 0) {
        finish({ success: false, text: '', format: '.pdf', status: 'failed', error: `pdftotext_exit_${code}` })
        return
      }
      const text = normalizeText(Buffer.concat(chunks).toString('utf8'))
      finish(text
        ? { success: true, text, format: '.pdf', status: 'indexed' }
        : { success: false, text: '', format: '.pdf', status: 'ocr_required' })
    })
  })
}

export async function extractAttachmentText(
  filePath: string,
  declaredSize = 0
): Promise<AttachmentTextResult> {
  const extension = extname(filePath).toLowerCase()
  const supported = PLAIN_TEXT_EXTENSIONS.has(extension) || ['.docx', '.pptx', '.xlsx', '.pdf'].includes(extension)
  if (!supported) return { success: false, text: '', format: extension, status: 'unsupported' }
  if (declaredSize > MAX_FILE_BYTES) return { success: false, text: '', format: extension, status: 'too_large' }
  try {
    if (extension === '.pdf') return await extractPdfText(filePath)
    const buffer = await readFile(filePath)
    if (buffer.length > MAX_FILE_BYTES) return { success: false, text: '', format: extension, status: 'too_large' }
    if (extension === '.xlsx') return await extractSpreadsheet(buffer)
    const text = PLAIN_TEXT_EXTENSIONS.has(extension)
      ? normalizeText(buffer.toString('utf8'))
      : await extractOfficeXml(buffer, extension)
    if (!text) return { success: false, text: '', format: extension, status: 'empty' }
    return { success: true, text, format: extension, status: 'indexed' }
  } catch (error: any) {
    return { success: false, text: '', format: extension, status: 'failed', error: String(error?.message || error) }
  }
}

export const ATTACHMENT_TEXT_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxTextChars: MAX_TEXT_CHARS,
  maxSpreadsheetSheets: MAX_SPREADSHEET_SHEETS,
  maxSpreadsheetRowsPerSheet: MAX_SPREADSHEET_ROWS_PER_SHEET,
  maxSpreadsheetCells: MAX_SPREADSHEET_CELLS
}
