import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessAutomaticSearchMaintenance,
  AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS,
  AUTOMATIC_SEARCH_MAINTENANCE_RETRY_MS
} from '../electron/services/automaticSearchMaintenancePolicy.ts'

const now = Date.parse('2026-08-11T12:00:00.000Z')

test('automatic search maintenance waits seven days after the authoritative audit', () => {
  const fresh = assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS + 1).toISOString(),
    idle: true
  })
  assert.equal(fresh.due, false)
  assert.equal(fresh.reason, 'fresh')

  const overdue = assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS).toISOString(),
    idle: true
  })
  assert.equal(overdue.due, true)
  assert.equal(overdue.reason, 'overdue')
})

test('automatic search maintenance defers while busy and repairs a missing audit when idle', () => {
  assert.deepEqual(assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: null,
    idle: false
  }), { due: false, reason: 'not_idle', nextAt: null })
  assert.deepEqual(assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: null,
    idle: true
  }), { due: true, reason: 'missing_audit', nextAt: null })
})

test('failed automatic search maintenance persists a six-hour retry window', () => {
  const lastAttemptAt = new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_RETRY_MS + 1).toISOString()
  const cooling = assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS * 2).toISOString(),
    lastAttemptAt,
    lastError: '磁盘暂不可写',
    idle: true
  })
  assert.equal(cooling.due, false)
  assert.equal(cooling.reason, 'retry_cooling_down')

  const retry = assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS * 2).toISOString(),
    lastAttemptAt: new Date(now - AUTOMATIC_SEARCH_MAINTENANCE_RETRY_MS).toISOString(),
    lastError: '磁盘暂不可写',
    idle: true
  })
  assert.equal(retry.due, true)
  assert.equal(retry.reason, 'overdue')
})

test('a later successful audit supersedes an older persisted failure', () => {
  const result = assessAutomaticSearchMaintenance({
    nowMs: now,
    checkedAt: new Date(now - 60_000).toISOString(),
    lastAttemptAt: new Date(now - 2 * 60 * 60_000).toISOString(),
    lastError: '旧失败',
    idle: true
  })
  assert.equal(result.due, false)
  assert.equal(result.reason, 'fresh')
})
