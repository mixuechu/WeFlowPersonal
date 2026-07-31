import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOMATIC_MEMORY_BACKUP_RETRY_MS,
  automaticMemoryBackupDate,
  shouldCreateAutomaticMemoryBackup
} from '../electron/services/automaticMemoryBackupPolicy.ts'

const completeResult = {
  success: true,
  partial: false,
  cancelled: false,
  documentSourceError: null,
  calendarSourceError: null,
  mailSourceError: null
}

test('automatic memory backup only becomes due after a complete sync and once per Shanghai day', () => {
  const now = Date.parse('2026-08-01T15:30:00.000Z')
  assert.equal(automaticMemoryBackupDate(now), '2026-08-01')
  assert.deepEqual(
    shouldCreateAutomaticMemoryBackup({ ...completeResult, partial: true }, {}, now),
    { create: false, reason: 'sync_incomplete', date: '2026-08-01' }
  )
  assert.deepEqual(
    shouldCreateAutomaticMemoryBackup(completeResult, {}, now),
    { create: true, reason: 'due', date: '2026-08-01' }
  )
  assert.deepEqual(
    shouldCreateAutomaticMemoryBackup(completeResult, { lastAutomaticBackupDate: '2026-08-01' }, now),
    { create: false, reason: 'already_created', date: '2026-08-01' }
  )
})

test('automatic memory backup failures retry after a bounded cross-restart backoff', () => {
  const now = Date.parse('2026-08-01T15:30:00.000Z')
  const failed = {
    lastAutomaticBackupAttemptAt: new Date(now - AUTOMATIC_MEMORY_BACKUP_RETRY_MS + 1).toISOString(),
    lastAutomaticBackupError: '磁盘暂不可写'
  }
  assert.equal(shouldCreateAutomaticMemoryBackup(completeResult, failed, now).reason, 'retry_backoff')
  assert.deepEqual(
    shouldCreateAutomaticMemoryBackup(completeResult, {
      ...failed,
      lastAutomaticBackupAttemptAt: new Date(now - AUTOMATIC_MEMORY_BACKUP_RETRY_MS).toISOString()
    }, now),
    { create: true, reason: 'due', date: '2026-08-01' }
  )
})
