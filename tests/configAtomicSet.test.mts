import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
  assert.doesNotMatch(persisted, /sk-batch-secret/)
  const storedApiKey = JSON.parse(persisted).aiAssistantApiKey
  assert.match(storedApiKey, /^local:v1:/)
  assert.equal(statSync(join(directory, 'secrets')).mode & 0o777, 0o700)
  assert.equal(statSync(join(directory, 'secrets', 'local-master-key.bin')).mode & 0o777, 0o600)
  assert.deepEqual(config.getLocalSecretStorageStatus(), {
    backend: 'local-file-aes-256-gcm-v1',
    available: true,
    directoryMode: '700',
    directoryIsDirectory: true,
    directorySymlink: false,
    keyFileMode: '600',
    keyFileRegular: true,
    keyFileSymlink: false,
    keyLengthValid: true,
    backupAvailable: true,
    recoveredThisStart: false,
    recoveryError: '',
    localEncryptedValues: 1,
    legacySafeValues: 0
  })
  const tamperOffset = 'local:v1:'.length + 20
  const tampered = storedApiKey.slice(0, tamperOffset) +
    (storedApiKey[tamperOffset] === 'A' ? 'B' : 'A') + storedApiKey.slice(tamperOffset + 1)
  ;(config as any).store.set('aiAssistantApiKey', tampered)
  assert.equal(config.get('aiAssistantApiKey'), '')
  config.set('aiAssistantApiKey', 'sk-batch-secret')
  assert.equal(config.get('aiAssistantApiKey'), 'sk-batch-secret')
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
