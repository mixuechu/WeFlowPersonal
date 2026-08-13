import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'

test('insight and message-analysis records use the encrypted cache boundary', () => {
  const service = readFileSync(
    new URL('../electron/services/insightRecordService.ts', import.meta.url),
    'utf8'
  )
  assert.match(service, /loadEncryptedSensitiveCache/)
  assert.match(service, /writeEncryptedSensitiveCache/)
  assert.match(service, /getOrCreateLocalCacheEncryptionKey\(\)/)
  assert.match(service, /version: 3, records: this\.records/)
  assert.doesNotMatch(service, /fs\.writeFileSync\([\s\S]{0,160}records: this\.records/)
  assert.match(service, /getPrivacyStatus\(\)/)
})

test('insight record encryption participates in complete privacy diagnostics', () => {
  const assistant = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url),
    'utf8'
  )
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(assistant, /insightRecords: insightRecordService\.getPrivacyStatus\(\)/)
  assert.match(page, /'insightRecords'/)
  assert.match(page, /联系人见解与消息分析/)
  assert.match(page, /sensitiveCaches\.insightRecords\.encrypted/)
})

test('legacy plaintext insight records migrate without retaining message previews', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-insight-encryption-'))
  const previousUserData = process.env.WEFLOW_USER_DATA_PATH
  const previousConfig = process.env.WEFLOW_CONFIG_CWD
  const previousWorker = process.env.WEFLOW_WORKER
  process.env.WEFLOW_USER_DATA_PATH = directory
  process.env.WEFLOW_CONFIG_CWD = directory
  process.env.WEFLOW_WORKER = '1'
  const path = join(directory, 'weflow-insight-records.json')
  try {
    writeFileSync(path, JSON.stringify({ version: 2, records: [{
      id: 'insight-private-1',
      accountScope: 'default',
      sourceType: 'message_analysis',
      createdAt: 1,
      sessionId: 'wxid-private-insight',
      displayName: '隐私联系人',
      triggerReason: 'message_analysis',
      insight: '这是需要加密的见解',
      read: false,
      messageInsight: {
        targetLocalId: 1,
        targetCreateTime: 1,
        targetMessageKey: 'private-key',
        targetSenderName: '隐私联系人',
        targetTextPreview: '需要加密的消息预览',
        analysis: { explicitText: '', emotion: '', intent: '', topic: '' }
      },
      log: { sensitivePayloadRetained: false }
    }] }))
    const { insightRecordService } = await import('../electron/services/insightRecordService.ts')
    insightRecordService.migratePrivacy()
    const content = readFileSync(path)
    assert.equal(isEncryptedDurableJson(content), true)
    for (const forbidden of ['wxid-private-insight', '隐私联系人', '需要加密的消息预览']) {
      assert.equal(content.toString('utf8').includes(forbidden), false)
    }
    const privacy = insightRecordService.getPrivacyStatus() as any
    assert.equal(privacy.encrypted, true)
    assert.equal(privacy.migratedPlaintext, true)
    assert.equal(privacy.entries, 1)
  } finally {
    if (previousUserData === undefined) delete process.env.WEFLOW_USER_DATA_PATH
    else process.env.WEFLOW_USER_DATA_PATH = previousUserData
    if (previousConfig === undefined) delete process.env.WEFLOW_CONFIG_CWD
    else process.env.WEFLOW_CONFIG_CWD = previousConfig
    if (previousWorker === undefined) delete process.env.WEFLOW_WORKER
    else process.env.WEFLOW_WORKER = previousWorker
    rmSync(directory, { recursive: true, force: true })
  }
})
