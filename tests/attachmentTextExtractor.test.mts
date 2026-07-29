import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { ATTACHMENT_TEXT_LIMITS, extractAttachmentText } from '../electron/services/attachmentTextExtractor.ts'

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
