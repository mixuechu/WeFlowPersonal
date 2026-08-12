import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  identityScanRetryStatus,
  planIdentityScanRetry
} from '../electron/services/identityDisambiguation.ts'

test('identity scan retry gate is due at the exact persisted boundary', () => {
  const nowMs = Date.parse('2026-08-12T00:00:00.000Z')
  assert.equal(identityScanRetryStatus('2026-08-12T00:00:01.000Z', nowMs), 'cooling_down')
  assert.equal(identityScanRetryStatus('2026-08-12T00:00:00.000Z', nowMs), 'due')
  assert.equal(identityScanRetryStatus('invalid', nowMs), 'due')
})

test('vector identity continuation checks persisted cooling before reading SQLCipher backlog', () => {
  const source = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const start = source.indexOf('private continueIdentityVectorScanWhileIdle')
  const end = source.indexOf('private continueFullIdentityScanWhileIdle', start)
  const continuation = source.slice(start, end)
  assert.ok(continuation.indexOf('identityScanRetryStatus(') <
    continuation.indexOf('personalMemoryStore.getIdentityVectorScanBacklog(model)'))
  assert.match(continuation, /identity_vector_scan_cooling_down/)
  assert.match(continuation, /planIdentityScanRetry/)
  assert.match(continuation, /vectorNextAttemptAt = retry\.nextAttemptAt/)
  assert.match(continuation, /persistCrossStoreMutationState/)
  assert.match(continuation, /if \(!backlog\.pending\)[\s\S]*vectorContinuationFailures = 0/)
  assert.match(continuation, /if \(!backlog\.pending\)[\s\S]*vectorNextAttemptAt = null/)

  const schedulerStart = source.indexOf('private async runSchedulerTick')
  const schedulerEnd = source.indexOf('private isNotificationQuiet', schedulerStart)
  const scheduler = source.slice(schedulerStart, schedulerEnd)
  assert.doesNotMatch(scheduler, /getIdentityVectorScanBacklog/)
  assert.match(scheduler, /continueIdentityVectorScanWhileIdle\(now\)/)
})

test('vector identity commit failure backs off and every successful page clears retry state', () => {
  const source = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const start = source.indexOf('private runVectorIdentityScan')
  const end = source.indexOf('private continueIdentityVectorScanWhileIdle', start)
  const scan = source.slice(start, end)
  assert.match(scan, /planIdentityScanRetry/)
  assert.match(scan, /vectorContinuationFailures = retry\.failures/)
  assert.match(scan, /vectorNextAttemptAt = retry\.nextAttemptAt/)
  assert.ok((scan.match(/vectorContinuationFailures = 0/g) || []).length >= 2)
  assert.ok((scan.match(/vectorNextAttemptAt = null/g) || []).length >= 2)

  const retry = planIdentityScanRetry(5, new Date('2026-08-12T00:00:00.000Z'))
  assert.equal(retry.failures, 6)
  assert.equal(retry.nextAttemptAt, '2026-08-12T06:00:00.000Z')
})

test('vector identity retry timing is visible in the assistant diagnostics UI', () => {
  const page = readFileSync(
    new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8'
  )
  assert.match(page, /向量身份巡检下次自动重试/)
  assert.match(page, /vectorContinuationFailures/)
  assert.match(page, /vectorNextAttemptAt/)
})
