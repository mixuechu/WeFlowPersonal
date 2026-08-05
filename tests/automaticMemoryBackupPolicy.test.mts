import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOMATIC_MEMORY_BACKUP_RETRY_MS,
  AUTOMATIC_MEMORY_BACKUP_STATE_POLICY_VERSION,
  automaticMemoryBackupDate,
  buildAutomaticMemoryBackupSnapshotState,
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

test('automatic backup marker rewrite keeps the encrypted task state bounded', () => {
  const state = {
    version: 3,
    cursor: {
      lastAutomaticBackupDate: '2026-08-06',
      lastAutomaticBackupAt: '2026-08-05T18:50:00.000Z',
      lastAutomaticBackupError: null
    },
    tasks: [{
      id: 'active-task',
      status: 'todo',
      title: '当前任务',
      evidence: [{ messageId: 'active-message', excerpt: '当前任务原文' }],
      sourceMessageIds: ['active-message']
    }, {
      id: 'closed-task',
      status: 'done',
      title: '多年历史任务',
      detail: '结构继续保留',
      evidence: Array.from({ length: 2_000 }, (_, index) => ({
        messageId: `closed-message-${index}`,
        excerpt: `不应复制进自动快照的历史原文 ${index}`
      })),
      sourceMessageIds: Array.from(
        { length: 2_000 },
        (_, index) => `closed-message-${index}`
      )
    }],
    graph: { entities: [], relations: [], reviewQueue: [] }
  }
  const snapshot = buildAutomaticMemoryBackupSnapshotState(state)
  assert.equal(
    AUTOMATIC_MEMORY_BACKUP_STATE_POLICY_VERSION,
    'automatic-memory-backup-state-v2'
  )
  assert.deepEqual(snapshot.cursor, state.cursor)
  assert.equal(snapshot.tasks[0].evidence.length, 1)
  assert.equal('evidence' in snapshot.tasks[1], false)
  assert.equal('sourceMessageIds' in snapshot.tasks[1], false)
  assert.equal(snapshot.tasks[1].detail, '结构继续保留')
  assert.equal(
    JSON.stringify(snapshot).includes('不应复制进自动快照的历史原文'),
    false
  )
  assert.equal(state.tasks[1].evidence.length, 2_000)
})
