import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { ATTACHMENT_TEXT_LIMITS, extractAttachmentText } from '../electron/services/attachmentTextExtractor.ts'

function createMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  const stream = text
    ? `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
    : '0 0 100 100 re S'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

test('attachment text extractor reads bounded UTF-8 text and rejects oversized input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-text-'))
  try {
    const filePath = join(directory, '项目说明.md')
    writeFileSync(filePath, '# 验收安排\n周五前完成第一轮验收。\n')
    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.equal(result.status, 'indexed')
    assert.match(result.text, /周五前完成第一轮验收/)

    const oversized = await extractAttachmentText(filePath, ATTACHMENT_TEXT_LIMITS.maxFileBytes + 1)
    assert.equal(oversized.status, 'too_large')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor recovers DOCX body text without cloud services', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-docx-'))
  try {
    const archive = new JSZip()
    archive.file('word/document.xml', [
      '<w:document><w:body>',
      '<w:p><w:r><w:t>客户交付清单</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>需要补齐测试报告</w:t></w:r></w:p>',
      '</w:body></w:document>'
    ].join(''))
    const filePath = join(directory, '交付清单.docx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))
    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.match(result.text, /客户交付清单/)
    assert.match(result.text, /需要补齐测试报告/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor indexes text-layer PDFs and marks image-only PDFs for OCR', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-pdf-'))
  try {
    const textPdf = join(directory, 'text.pdf')
    const imageOnlyPdf = join(directory, 'scan.pdf')
    writeFileSync(textPdf, createMinimalPdf('WeFlow PDF attachment index test'))
    writeFileSync(imageOnlyPdf, createMinimalPdf(''))
    const indexed = await extractAttachmentText(textPdf)
    assert.equal(indexed.status, 'indexed')
    assert.match(indexed.text, /WeFlow PDF attachment index test/)
    const scan = await extractAttachmentText(imageOnlyPdf)
    assert.equal(scan.status, 'ocr_required')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
