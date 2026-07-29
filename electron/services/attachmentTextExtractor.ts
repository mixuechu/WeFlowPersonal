import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { spawn } from 'node:child_process'
import JSZip from 'jszip'

export type AttachmentTextResult = {
  success: boolean
  text: string
  format: string
  status: 'indexed' | 'unsupported' | 'too_large' | 'empty' | 'ocr_required' | 'dependency_missing' | 'failed'
  error?: string
}

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 16_000
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
  maxTextChars: MAX_TEXT_CHARS
}
