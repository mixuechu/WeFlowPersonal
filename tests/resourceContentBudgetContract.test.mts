import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('scanned PDF continuation stops when the authoritative resource text budget is full', () => {
  assert.match(service, /projectedChars > RESOURCE_CONTENT_CHAR_LIMIT/)
  assert.match(service, /attachmentPdfOcrTruncated: storageTruncated \? false/)
  assert.match(service, /attachmentPdfOcrStorageTruncated: storageTruncated/)
  assert.match(service, /attachmentPdfOcrUnindexedFromPage: storageTruncated \? startPage : 0/)
})

test('resource dossiers disclose storage truncation and its model boundary', () => {
  assert.match(page, /contentStorageTruncated/)
  assert.match(page, /正文预算已满/)
  assert.match(page, /超出部分未被模型读取/)
})
