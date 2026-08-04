import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertAssistantSettingsMutationToken,
  buildAssistantSettingsMutationToken,
  normalizeAssistantSettingsInput,
  type AssistantSettingsMutationIdentity
} from '../electron/services/assistantSettingsMutationPolicy.ts'

const settings = (overrides: Partial<AssistantSettingsMutationIdentity> = {}):
AssistantSettingsMutationIdentity => ({
  configured: true,
  apiKeySecret: 'sk-local-secret',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  scheduleTime: '20:00',
  quietStart: '22:00',
  quietEnd: '08:00',
  inputCostPerMillion: 1,
  outputCostPerMillion: 2,
  enabled: true,
  ownerName: '用户',
  ownerAliases: '我',
  ownerBackground: '本机用户',
  transcribeVoice: false,
  ocrImages: false,
  analyzeImages: true,
  indexWebLinks: false,
  resourceTrashRetentionDays: 30,
  sensitiveRedactionLevel: 'standard',
  ...overrides
})

test('assistant settings token binds every visible privacy and scheduling field', () => {
  const current = settings()
  const token = buildAssistantSettingsMutationToken(current)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.doesNotThrow(() => assertAssistantSettingsMutationToken(current, token))
  assert.notEqual(token, buildAssistantSettingsMutationToken(settings({ enabled: false })))
  assert.notEqual(token, buildAssistantSettingsMutationToken(settings({
    sensitiveRedactionLevel: 'strict'
  })))
  assert.notEqual(token, buildAssistantSettingsMutationToken(settings({
    ownerBackground: '新的背景'
  })))
})

test('assistant settings token detects secret changes without exposing the secret', () => {
  const current = settings()
  const token = buildAssistantSettingsMutationToken(current)
  assert.equal(token.includes(current.apiKeySecret), false)
  assert.notEqual(token, buildAssistantSettingsMutationToken(settings({
    apiKeySecret: 'sk-replaced-secret'
  })))
  assert.throws(() => assertAssistantSettingsMutationToken(
    settings({ apiKeySecret: 'sk-replaced-secret' }),
    token
  ), /AI 助理设置在展示后发生了变化/)
  assert.throws(() => assertAssistantSettingsMutationToken(current, ''), /发生了变化/)
})

test('assistant settings input is normalized as one complete valid patch', () => {
  const patch = normalizeAssistantSettingsInput({
    ...settings(),
    apiKey: '  sk-new-secret  ',
    baseUrl: '  http://127.0.0.1:9000/v1  ',
    ownerName: '  用户  ',
    resourceTrashRetentionDays: 90
  })
  assert.equal(patch.aiAssistantApiKey, 'sk-new-secret')
  assert.equal(patch.aiAssistantApiBaseUrl, 'http://127.0.0.1:9000/v1')
  assert.equal(patch.aiAssistantOwnerName, '用户')
  assert.equal(patch.aiAssistantResourceTrashRetentionDays, 90)
})

test('assistant settings reject malformed input before a patch exists', () => {
  assert.throws(() => normalizeAssistantSettingsInput({
    ...settings(), scheduleTime: '29:99'
  }), /有效时间/)
  assert.throws(() => normalizeAssistantSettingsInput({
    ...settings(), baseUrl: 'file:\/\/\/tmp\/model'
  }), /http 或 https/)
  assert.throws(() => normalizeAssistantSettingsInput({
    ...settings(), outputCostPerMillion: Number.NaN
  }), /有效数字/)
  assert.throws(() => normalizeAssistantSettingsInput({
    ...settings(), ocrImages: 'false'
  }), /图片文字识别开关/)
})
