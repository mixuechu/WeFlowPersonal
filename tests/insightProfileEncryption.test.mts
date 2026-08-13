import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'
import { loadInsightProfileCache } from '../electron/services/insightProfileCache.ts'

test('contact profile records use the encrypted cache boundary and complete diagnostics', () => {
  const service = readFileSync(new URL('../electron/services/insightProfileService.ts', import.meta.url), 'utf8')
  const assistant = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(service, /loadInsightProfileCache/)
  assert.match(service, /writeInsightProfileCache/)
  assert.doesNotMatch(service, /fs\.writeFileSync\([\s\S]{0,180}records: this\.records/)
  assert.match(assistant, /insightProfiles: insightProfileService\.getPrivacyStatus\(\)/)
  assert.match(page, /'insightProfiles'/)
  assert.match(page, /联系人年度画像/)
})

test('legacy plaintext contact profiles migrate without losing their summaries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-profile-encryption-'))
  const filePath = join(directory, 'weflow-insight-profiles.json')
  const key = Buffer.alloc(32, 7)
  try {
    writeFileSync(filePath, JSON.stringify({ version: 1, records: [{
      id: 'profile-private-1', accountScope: 'default', sessionId: 'wxid-private-profile',
      displayName: '画像联系人', createdAt: 1, updatedAt: 2, rangeStart: 1, rangeEnd: 2,
      months: ['2026-01'], emptyMonths: [], monthlySummaries: [{ month: '2026-01',
        messageCount: 5, compressed: false, sampledMessages: 5, summary: '私密月度摘要' }],
      finalProfile: '私密最终人物画像', stats: { scannedMessages: 5, summarizedMonths: 1,
        emptyMonths: 0, compressedMonths: 0 }, model: 'test-model'
    }] }))
    const loaded = loadInsightProfileCache<any>(filePath, key)
    const content = readFileSync(filePath)
    assert.equal(isEncryptedDurableJson(content), true)
    for (const forbidden of ['wxid-private-profile', '画像联系人', '私密月度摘要', '私密最终人物画像']) {
      assert.equal(content.toString('utf8').includes(forbidden), false)
    }
    assert.equal(loaded.privacy.encrypted, true)
    assert.equal(loaded.privacy.migratedPlaintext, true)
    assert.equal(loaded.value.records.length, 1)
    assert.equal(loaded.value.records[0].finalProfile, '私密最终人物画像')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
