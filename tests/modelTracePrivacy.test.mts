import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_TRACE_PRIVACY_VERSION,
  modelTraceContainsSensitivePayload,
  sanitizePersistedModelTrace
} from '../shared/modelTracePrivacy.ts'

test('persisted model traces retain operational metadata but remove prompt and raw output copies', () => {
  const sanitized = sanitizePersistedModelTrace({
    endpoint: 'https://api.example.com/chat/completions',
    model: 'deepseek-chat',
    durationMs: 1234,
    systemPrompt: 'private system instructions',
    userPrompt: 'private chat transcript',
    rawOutput: 'private model response',
    finalInsight: '结构化结果',
    parsedAnalysis: { topic: '项目' }
  })
  assert.equal(sanitized.systemPrompt, '')
  assert.equal(sanitized.userPrompt, '')
  assert.equal(sanitized.rawOutput, '')
  assert.equal(sanitized.endpoint, 'https://api.example.com/chat/completions')
  assert.equal(sanitized.model, 'deepseek-chat')
  assert.equal(sanitized.durationMs, 1234)
  assert.equal(sanitized.finalInsight, '结构化结果')
  assert.deepEqual(sanitized.parsedAnalysis, { topic: '项目' })
  assert.equal(sanitized.privacyVersion, MODEL_TRACE_PRIVACY_VERSION)
  assert.equal(sanitized.sensitivePayloadRetained, false)
  assert.equal(modelTraceContainsSensitivePayload(sanitized), false)
})

test('legacy trace detection catches each sensitive duplicate independently', () => {
  assert.equal(modelTraceContainsSensitivePayload({ systemPrompt: 'secret' }), true)
  assert.equal(modelTraceContainsSensitivePayload({ userPrompt: 'chat' }), true)
  assert.equal(modelTraceContainsSensitivePayload({ rawOutput: 'answer' }), true)
  assert.equal(modelTraceContainsSensitivePayload({ finalInsight: 'safe result' }), false)
})
