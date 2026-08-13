import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isEncryptedDurableJson, readEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'
import { writeEncryptedSensitiveCache } from '../electron/services/encryptedSensitiveCache.ts'

test('export history uses encrypted local storage and complete privacy diagnostics', () => {
  const service = readFileSync(new URL('../electron/services/exportRecordService.ts', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const assistant = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(service, /loadEncryptedSensitiveCache/)
  assert.match(service, /writeEncryptedSensitiveCache/)
  assert.doesNotMatch(service, /fs\.writeFileSync/)
  assert.match(main, /exportRecordService\.migratePrivacy\(\)/)
  assert.match(assistant, /exportRecords: exportRecordService\.getPrivacyStatus\(\)/)
  assert.match(page, /'exportRecords'/)
  assert.match(page, /导出历史记录/)
})

test('encrypted durable boundary preserves export history without plaintext path leakage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-export-record-encryption-'))
  const filePath = join(directory, 'weflow-export-records.json')
  const key = Buffer.alloc(32, 9)
  try {
    const legacy = { 'wxid-private-export': [{ exportTime: 1, format: 'json', messageCount: 4,
      outputPath: '/Users/private/Documents/private-chat.json' }] }
    writeFileSync(filePath, JSON.stringify(legacy))
    const loaded = readEncryptedDurableJson<Record<string, unknown>>(filePath, {}, key)
    assert.equal(loaded.encrypted, false)
    writeEncryptedSensitiveCache(filePath, { version: 2, records: loaded.value }, key)
    const content = readFileSync(filePath)
    assert.equal(isEncryptedDurableJson(content), true)
    assert.equal(content.toString('utf8').includes('wxid-private-export'), false)
    assert.equal(content.toString('utf8').includes('private-chat.json'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
