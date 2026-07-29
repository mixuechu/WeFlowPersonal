import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractScannedPdfText, getPdfOcrStatus, PDF_OCR_LIMITS } from '../electron/services/pdfOcrService.ts'

function createGraphicsOnlyPdf(): Buffer {
  const stream = '0 0 0 RG 2 w 72 700 220 40 re S'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

test('scanned PDF OCR reports local capability and cleans temporary render pages', async t => {
  const status = await getPdfOcrStatus()
  if (!status.available) {
    t.skip('Poppler or Chinese Tesseract model is unavailable')
    return
  }
  assert.equal(PDF_OCR_LIMITS.maxPages, 3)
  const directory = mkdtempSync(join(tmpdir(), 'weflow-pdf-ocr-test-'))
  const before = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('weflow-pdf-ocr-')))
  try {
    const filePath = join(directory, 'graphics-only.pdf')
    writeFileSync(filePath, createGraphicsOnlyPdf())
    const result = await extractScannedPdfText(filePath)
    assert.equal(result.status, 'empty')
    assert.equal(result.processedPages, 1)
    assert.equal(result.totalPages, 1)
    assert.equal(result.nextPage, 2)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  const after = readdirSync(tmpdir()).filter(name => name.startsWith('weflow-pdf-ocr-') && !before.has(name))
  assert.deepEqual(after.filter(name => existsSync(join(tmpdir(), name))), [])
})
