import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('config batch commit persists all assistant settings in one store replacement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-config-batch-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  const { normalizeAssistantSettingsInput } =
    await import('../electron/services/assistantSettingsMutationPolicy.ts')
  const config = new ConfigService()
  config.setMany({
    aiAssistantEnabled: false,
    aiAssistantOwnerName: '批量设置用户',
    aiAssistantSensitiveRedactionLevel: 'strict',
    aiAssistantApiKey: 'sk-batch-secret'
  })
  assert.equal(config.get('aiAssistantEnabled'), false)
  assert.equal(config.get('aiAssistantOwnerName'), '批量设置用户')
  assert.equal(config.get('aiAssistantSensitiveRedactionLevel'), 'strict')
  assert.equal(config.get('aiAssistantApiKey'), 'sk-batch-secret')
  const persisted = readFileSync(join(directory, 'WeFlow-config.json'), 'utf8')
  assert.match(persisted, /批量设置用户/)
  assert.match(persisted, /strict/)
  const before = config.get('aiAssistantOwnerName')
  assert.throws(() => config.setMany({
    aiAssistantOwnerName: '不应保存',
    someCacheMap: { unsafe: true }
  } as any), /不支持旁路缓存字段/)
  assert.equal(config.get('aiAssistantOwnerName'), before)
  assert.throws(() => {
    const malformed = normalizeAssistantSettingsInput({
      configured: true,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      scheduleTime: '27:75',
      quietStart: '22:00',
      quietEnd: '08:00',
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
      enabled: true,
      ownerName: '不应保存',
      ownerAliases: '',
      ownerBackground: '',
      transcribeVoice: false,
      ocrImages: false,
      analyzeImages: true,
      indexWebLinks: false,
      resourceTrashRetentionDays: 30,
      sensitiveRedactionLevel: 'standard'
    })
    config.setMany(malformed)
  }, /有效时间/)
  assert.equal(config.get('aiAssistantOwnerName'), before)
  rmSync(directory, { recursive: true, force: true })
})
