import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('vector continuation timer delegates through one final rejection boundary', () => {
  const scheduleStart = service.indexOf('private scheduleVectorIndexContinuation')
  const runnerStart = service.indexOf('private async runVectorIndexContinuation', scheduleStart)
  assert.ok(scheduleStart >= 0)
  assert.ok(runnerStart > scheduleStart)
  const schedule = service.slice(scheduleStart, runnerStart)
  assert.match(schedule, /runVectorIndexContinuation\(\)\.catch\(error =>/)
  assert.match(schedule, /sanitizeDiagnosticText\(error\)/)
  assert.match(schedule, /handleVectorIndexContinuationFailure\(error\)/)
  assert.doesNotMatch(schedule, /void this\.ensureVectorIndex/)
})

test('vector continuation contains synchronous gates and asynchronous indexing together', () => {
  const runnerStart = service.indexOf('private async runVectorIndexContinuation')
  const runnerEnd = service.indexOf('private persistVectorIndexContinuationHealth', runnerStart)
  const runner = service.slice(runnerStart, runnerEnd)
  assert.match(runner, /try \{[\s\S]*this\.config\.get\('aiAssistantEnabled'\)/)
  assert.match(runner, /await this\.ensureVectorIndex\(\{ maxBatches: 2 \}\)/)
  assert.match(runner, /catch \(error\) \{[\s\S]*handleVectorIndexContinuationFailure\(error\)/)
  assert.match(runner, /if \(!enabled \|\| this\.disposed\)/)
  assert.match(runner, /type: 'failed'/)
  assert.match(runner, /persistVectorIndexContinuationHealth\(\)[\s\S]*scheduleVectorIndexContinuation\(\)/)
  assert.match(runner, /无法重新安排向量续建/)
})
