import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeResourceContentBudgetMigrationHealth,
  planResourceContentBudgetRetry,
  resourceContentBudgetRetryCoolingDown
} from '../electron/services/resourceContentBudgetPolicy.ts'

test('resource content repair retry grows to a bounded six-hour delay', () => {
  const now = new Date('2026-08-12T00:00:00.000Z')
  const expectedMinutes = [5, 15, 30, 60, 180, 360, 360]
  expectedMinutes.forEach((minutes, previousFailures) => {
    const retry = planResourceContentBudgetRetry(previousFailures, now)
    assert.equal(retry.failureStreak, previousFailures + 1)
    assert.equal(Date.parse(retry.nextAttemptAt), now.getTime() + minutes * 60_000)
  })
})

test('resource content repair retry becomes due at its exact persisted boundary', () => {
  const nowMs = Date.parse('2026-08-12T00:00:00.000Z')
  assert.equal(resourceContentBudgetRetryCoolingDown(
    '2026-08-12T00:00:01.000Z', nowMs
  ), true)
  assert.equal(resourceContentBudgetRetryCoolingDown(
    '2026-08-12T00:00:00.000Z', nowMs
  ), false)
  assert.equal(resourceContentBudgetRetryCoolingDown('invalid', nowMs), false)
})

test('resource content migration health exposes only bounded validated diagnostics', () => {
  const normalized = normalizeResourceContentBudgetMigrationHealth({
    checkedAt: '2026-08-12T08:00:00+08:00',
    batchLimit: 100.9,
    checked: -1,
    repaired: Number.POSITIVE_INFINITY,
    failureStreak: 2.8,
    lastErrorAt: 'invalid',
    lastError: '错'.repeat(800),
    nextAttemptAt: '2026-08-12T00:15:00Z',
    privateFutureField: 'must-not-cross-ipc'
  })
  assert.equal(normalized.checkedAt, '2026-08-12T00:00:00.000Z')
  assert.equal(normalized.batchLimit, 100)
  assert.equal(normalized.checked, 0)
  assert.equal(normalized.repaired, 0)
  assert.equal(normalized.failureStreak, 2)
  assert.equal(normalized.lastErrorAt, '')
  assert.equal(normalized.lastError.length, 500)
  assert.equal(normalized.nextAttemptAt, '2026-08-12T00:15:00.000Z')
  assert.equal('privateFutureField' in normalized, false)
})
