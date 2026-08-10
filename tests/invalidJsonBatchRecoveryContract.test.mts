import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('invalid model JSON is split before a batch is recorded as failed', () => {
  assert.match(service, /parseModelJsonObject\(payload\?\.choices\?\.\[0\]\?\.message\?\.content\)/)
  assert.match(service, /finishReason === 'length'[\s\S]*modelError\.code = 'model_json_truncated'/)
  assert.match(service, /max_tokens: attempt \? 8000 : 5000/)
  assert.match(service, /thinking: \{ type: 'disabled' \}[\s\S]*response_format: \{ type: 'json_object' \}/)
  assert.match(service, /isInvalidModelJsonFailure\(error\) && work\.splitDepth < 2/)
  assert.match(service, /splitSaturatedAnalysisBatch\(batch, \{ messageKey, minimumCoreSize: 25 \}\)/)
  assert.match(service, /batchQueue\.unshift\([\s\S]*'invalid_json' as const[\s\S]*continue[\s\S]*recordIngestionBatch/)
})

test('invalid JSON recovery remains visible without exposing model output', () => {
  assert.match(service, /invalidJsonFailures: work\.invalidJsonFailures \+ \(isInvalidModelJsonFailure\(error\) \? 2 : 0\)/)
  assert.match(service, /inputTokens: Number\(modelFailureMeta\.inputTokens \|\| 0\)/)
  assert.match(page, /检测到模型 JSON 不完整/)
  assert.match(page, /JSON 无效/)
  assert.doesNotMatch(page, /invalidJsonRawOutput|rawInvalidJson/)
})
