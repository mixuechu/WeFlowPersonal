import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  EMPTY_SCHEDULER_RUNTIME_RETRY,
  clearSchedulerRuntimeFailure,
  normalizeSchedulerRuntimeRetry,
  planSchedulerRuntimeFailure,
  schedulerRuntimeCoolingDown
} from '../electron/services/schedulerRuntimePolicy.ts'
import { commitPersistedRuntimeTransition } from '../electron/services/persistedRuntimeTransition.ts'

test('runtime recovery is published only after its encrypted checkpoint commits', () => {
  let state = { failures: 3, nextAttemptAt: 'later' }
  assert.throws(() => commitPersistedRuntimeTransition(
    state,
    { failures: 0, nextAttemptAt: '' },
    value => { state = value },
    () => { throw new Error('state file unavailable') }
  ), /state file unavailable/)
  assert.deepEqual(state, { failures: 3, nextAttemptAt: 'later' })

  commitPersistedRuntimeTransition(
    state,
    { failures: 0, nextAttemptAt: '' },
    value => { state = value },
    () => {}
  )
  assert.deepEqual(state, { failures: 0, nextAttemptAt: '' })
})

test('unexpected scheduler failures back off across restart up to six hours', () => {
  const now = new Date('2026-08-12T00:00:00.000Z')
  const expectedMinutes = [5, 15, 30, 60, 180, 360, 360]
  expectedMinutes.forEach((minutes, previousFailures) => {
    const retry = planSchedulerRuntimeFailure({
      ...EMPTY_SCHEDULER_RUNTIME_RETRY,
      failures: previousFailures
    }, now, 'unexpected database failure')
    assert.equal(retry.failures, previousFailures + 1)
    assert.equal(Date.parse(retry.nextAttemptAt || ''), now.getTime() + minutes * 60_000)
  })
})

test('scheduler circuit breaker is due at its exact retry boundary and records recovery', () => {
  const failed = planSchedulerRuntimeFailure(
    EMPTY_SCHEDULER_RUNTIME_RETRY,
    new Date('2026-08-12T00:00:00.000Z'),
    'failure'
  )
  assert.equal(schedulerRuntimeCoolingDown(failed, Date.parse('2026-08-12T00:04:59Z')), true)
  assert.equal(schedulerRuntimeCoolingDown(failed, Date.parse('2026-08-12T00:05:00Z')), false)
  const recovered = clearSchedulerRuntimeFailure(
    failed,
    new Date('2026-08-12T00:05:01.000Z')
  )
  assert.equal(recovered.failures, 0)
  assert.equal(recovered.lastError, null)
  assert.equal(recovered.nextAttemptAt, null)
  assert.equal(recovered.lastRecoveredAt, '2026-08-12T00:05:01.000Z')
})

test('scheduler circuit breaker state is bounded and private at restart', () => {
  const normalized = normalizeSchedulerRuntimeRetry({
    failures: 4.8,
    lastFailureAt: '2026-08-12T08:00:00+08:00',
    lastError: '错'.repeat(800),
    nextAttemptAt: 'invalid',
    lastRecoveredAt: 42,
    privateQuery: 'must-not-survive'
  })
  assert.equal(normalized.failures, 4)
  assert.equal(normalized.lastFailureAt, '2026-08-12T00:00:00.000Z')
  assert.equal(normalized.lastError?.length, 500)
  assert.equal(normalized.nextAttemptAt, null)
  assert.equal(normalized.lastRecoveredAt, null)
  assert.equal('privateQuery' in normalized, false)
})

test('every scheduler tick passes through one final unexpected-failure circuit breaker', () => {
  const source = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const gateStart = source.indexOf('private async runSchedulerTickGuarded')
  const coreStart = source.indexOf('private async runSchedulerTick(', gateStart)
  const gate = source.slice(gateStart, coreStart)
  assert.match(source, /const promise = this\.runSchedulerTickGuarded\(source, observedNow\)/)
  assert.ok(gate.indexOf('schedulerRuntimeCoolingDown(') <
    gate.indexOf('this.runSchedulerTick(source, now)'))
  assert.match(gate, /recordSchedulerRuntimeFailure\(error, now\)/)
  assert.match(gate, /clearSchedulerRuntimeFailure/)
  assert.match(gate, /commitPersistedRuntimeTransition/)
  assert.match(gate, /persistCrossStoreMutationState/)
  assert.match(gate, /scheduler_runtime_failed/)
  assert.match(source, /private recordSchedulerRuntimeFailure[\s\S]*planSchedulerRuntimeFailure[\s\S]*persistCrossStoreMutationState/)
  const failureWriterStart = source.indexOf('private recordSchedulerRuntimeFailure')
  const failureWriterEnd = source.indexOf('private migrateLegacyData', failureWriterStart)
  const failureWriter = source.slice(failureWriterStart, failureWriterEnd)
  assert.match(failureWriter, /commitPersistedRuntimeTransition\(/)
  assert.doesNotMatch(failureWriter, /schedulerRuntimeRetry = planSchedulerRuntimeFailure/)

  const page = readFileSync(
    new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8'
  )
  assert.match(page, /后台调度保险丝已触发/)
  assert.match(page, /schedulerRuntime\.nextAttemptAt/)
})
