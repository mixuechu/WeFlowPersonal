import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { localOcrService } from './localOcrService.ts'

const execFileAsync = promisify(execFile)
const MAX_PAGES = 3
const RENDER_DPI = 120

function executable(name: 'pdftoppm' | 'pdfinfo'): string {
  return [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find(existsSync) || ''
}

export async function getPdfOcrStatus(): Promise<{
  available: boolean
  renderer: boolean
  ocr: boolean
  chinese: boolean
}> {
  const renderer = Boolean(executable('pdftoppm'))
  const ocr = await localOcrService.getStatus()
  return { available: renderer && ocr.available && ocr.chinese, renderer, ocr: ocr.available, chinese: ocr.chinese }
}

async function pdfPageCount(filePath: string): Promise<number> {
  const binary = executable('pdfinfo')
  if (!binary) return 0
  try {
    const { stdout } = await execFileAsync(binary, [filePath], { timeout: 5_000, maxBuffer: 256 * 1024 })
    return Number(String(stdout).match(/^Pages:\s+(\d+)/m)?.[1] || 0)
  } catch {
    return 0
  }
}

export async function extractScannedPdfText(filePath: string, startPage = 1): Promise<{
  success: boolean
  text: string
  status: 'indexed' | 'dependency_missing' | 'empty' | 'failed'
  processedPages: number
  totalPages: number
  truncated: boolean
  nextPage: number
  error?: string
}> {
  const status = await getPdfOcrStatus()
  if (!status.available) {
    return { success: false, text: '', status: 'dependency_missing', processedPages: 0, totalPages: 0, truncated: false, nextPage: startPage }
  }
  const directory = mkdtempSync(join(tmpdir(), 'weflow-pdf-ocr-'))
  const prefix = join(directory, 'page')
  try {
    const totalPages = await pdfPageCount(filePath)
    const safeStartPage = Math.max(1, Math.floor(Number(startPage || 1)))
    const endPage = safeStartPage + MAX_PAGES - 1
    await execFileAsync(executable('pdftoppm'), [
      '-f', String(safeStartPage), '-l', String(endPage), '-r', String(RENDER_DPI), '-png', filePath, prefix
    ], { timeout: 45_000, maxBuffer: 512 * 1024 })
    const pages = readdirSync(directory)
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .slice(0, MAX_PAGES)
    const text: string[] = []
    for (const [index, page] of pages.entries()) {
      const result = await localOcrService.recognize(join(directory, page), {
        timeoutMs: 20_000,
        maxChars: 5_000,
        psm: 6
      })
      const recognized = String(result.text || '').trim()
      const meaningfulCharacters = recognized.match(/[\p{L}\p{N}]/gu) || []
      if (result.success && meaningfulCharacters.length >= 2) text.push(`[第 ${safeStartPage + index} 页] ${recognized}`)
    }
    const combined = text.join('\n').slice(0, 14_000)
    return {
      success: Boolean(combined),
      text: combined,
      status: combined ? 'indexed' : 'empty',
      processedPages: pages.length,
      totalPages,
      truncated: totalPages > safeStartPage + pages.length - 1,
      nextPage: safeStartPage + pages.length
    }
  } catch (error: any) {
    return {
      success: false,
      text: '',
      status: 'failed',
      processedPages: 0,
      totalPages: 0,
      truncated: false,
      nextPage: startPage,
      error: `${basename(filePath)}: ${String(error?.message || error).slice(0, 200)}`
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export const PDF_OCR_LIMITS = { maxPages: MAX_PAGES, dpi: RENDER_DPI, renderTimeoutMs: 45_000, pageOcrTimeoutMs: 20_000 }
