import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  identityNameScanIdleStatus,
  planIdentityScanRetry
} from '../electron/services/identityDisambiguation.ts'

const idle = {
  pending: true,
  nextAttemptAt: null,
  nowMs: Date.parse('2026-08-12T00:00:00.000Z'),
  maintenance: false,
  syncing: false,
  vectorIndexing: false,
  searchRepairing: false,
  resourceEnriching: false,
  taskAuditing: false
}

test('name identity continuation runs only while every authoritative writer is idle', () => {
  assert.equal(identityNameScanIdleStatus(idle), 'due')
  assert.equal(identityNameScanIdleStatus({ ...idle, pending: false }), 'no_pending_scan')
  for (const key of [
    'maintenance', 'syncing', 'vectorIndexing', 'searchRepairing',
    'resourceEnriching', 'taskAuditing'
  ] as const) {
    assert.equal(identityNameScanIdleStatus({ ...idle, [key]: true }), 'busy', key)
  }
})

test('name identity continuation respects persisted retry cooling-down time', () => {
  assert.equal(identityNameScanIdleStatus({
    ...idle,
    nextAttemptAt: '2026-08-12T00:05:00.000Z'
  }), 'cooling_down')
  assert.equal(identityNameScanIdleStatus({
    ...idle,
    nextAttemptAt: '2026-08-12T00:00:00.000Z'
  }), 'due')
})

test('name identity retry uses bounded exponential-style backoff', () => {
  const now = new Date('2026-08-12T00:00:00.000Z')
  const expectedMinutes = [5, 15, 30, 60, 180, 360, 360]
  expectedMinutes.forEach((minutes, previousFailures) => {
    const retry = planIdentityScanRetry(previousFailures, now)
    assert.equal(retry.failures, previousFailures + 1)
    assert.equal(Date.parse(retry.nextAttemptAt), now.getTime() + minutes * 60_000)
  })
})

test('scheduler advances one bounded name page without requiring messages or DeepSeek', () => {
  const source = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const continuationStart = source.indexOf('private continueFullIdentityScanWhileIdle')
  const nextMethod = source.indexOf('private async syncLocalDocuments', continuationStart)
  const continuation = source.slice(continuationStart, nextMethod)
  const schedulerStart = source.indexOf('private async runSchedulerTick')
  const schedulerEnd = source.indexOf('private isNotificationQuiet', schedulerStart)
  const scheduler = source.slice(schedulerStart, schedulerEnd)
  assert.match(continuation, /this\.runScheduledIdentityScan\(observedAt\)/)
  assert.match(continuation, /this\.saveState\(true\)/)
  assert.match(continuation, /recoverGraphStateFromSql\(graphBefore, sqlSnapshot, sqlCommitId\)/)
  assert.match(continuation, /fullScanContinuationError: sanitizeDiagnosticText\(error\)/)
  assert.match(continuation, /planIdentityScanRetry/)
  assert.match(continuation, /fullScanNextAttemptAt: retry\.nextAttemptAt/)
  assert.match(continuation, /this\.persistCrossStoreMutationState\(\)/)
  assert.match(continuation, /commitPersistedRuntimeTransition\(/)
  assert.doesNotMatch(continuation, /persistCrossStoreMutationState\(\) \} catch \{\}/)
  assert.doesNotMatch(continuation, /callAi|collectMessages/)
  assert.match(scheduler, /continueFullIdentityScanWhileIdle\(now\)/)
  assert.ok(scheduler.indexOf('continueFullIdentityScanWhileIdle(now)') <
    scheduler.indexOf('continueIdentityVectorScanWhileIdle(now)'))
})

test('name continuation progress and retry failure remain visible without exposing its cursor', () => {
  const page = readFileSync(
    new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8'
  )
  assert.match(page, /最近空闲同名巡检续跑/)
  assert.match(page, /本轮同名巡检未提交/)
  assert.match(page, /断点保持原位，空闲后自动重试/)
  assert.match(page, /同名巡检下次自动重试/)
})
