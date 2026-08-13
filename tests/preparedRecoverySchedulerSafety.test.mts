import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('prepared commit recovery timer contains database failures and persists backoff', () => {
  const service = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const start = service.indexOf('private schedulePreparedRecoveryContinuation')
  const end = service.indexOf('private async ensureHttpApi', start)
  const continuation = service.slice(start, end)
  assert.match(continuation, /preparedRecoveryRetry\.nextAttemptAt/)
  assert.match(continuation, /schedulerRuntimeCoolingDown/)
  assert.match(continuation, /try \{[\s\S]*getIngestionCommitHealth/)
  assert.match(continuation, /catch \(error\) \{[\s\S]*planSchedulerRuntimeFailure/)
  assert.match(continuation, /persistCrossStoreMutationState/)
  assert.match(continuation, /clearSchedulerRuntimeFailure/)
  assert.match(continuation, /commitPersistedRuntimeTransition/)
  assert.match(continuation, /if \(this\.disposed\) return/)
  assert.doesNotMatch(continuation, /\}, 1_000\)/)
})

test('prepared commit recovery retry is normalized at restart and visible without payloads', () => {
  const service = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  assert.match(service, /preparedRecoveryRetry: normalizeSchedulerRuntimeRetry/)
  assert.match(service, /preparedRecoveryScheduler: \{[\s\S]*preparedRecoveryRetry/)

  const page = readFileSync(
    new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8'
  )
  assert.match(page, /中断提交后台恢复暂停/)
  assert.match(page, /preparedRecoveryScheduler\.nextAttemptAt/)
  assert.doesNotMatch(page, /preparedRecoveryScheduler\.(payload|commitId|sessionId)/)
})

test('startup notification timer contains a storage-level flush rejection', () => {
  const service = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const start = service.indexOf('this.startupNotificationTimer = setTimeout')
  const end = service.indexOf('this.startupNotificationTimer.unref()', start)
  const timer = service.slice(start, end)
  assert.match(timer, /flushNotificationOutbox\(new Date\(\)\)\.catch/)
  assert.match(timer, /sanitizeDiagnosticText\(error\)/)
})
