import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TASK_STATE_STORAGE_VERSION,
  buildEncryptedAssistantState,
  getTaskStateStorageStats
} from '../shared/taskStateStorage.ts'

test('encrypted assistant state omits only closed-task evidence copies', () => {
  const active = {
    id: 'active', status: 'todo', title: '进行中',
    evidence: [{ messageId: 'active-message', excerpt: 'active secret' }],
    sourceMessageIds: ['active-message']
  }
  const closed = {
    id: 'closed', status: 'done', title: '已完成', detail: '保留结构',
    evidence: Array.from({ length: 2_000 }, (_, index) => ({
      messageId: `closed-message-${index}`, excerpt: `closed secret ${index}`
    })),
    sourceMessageIds: Array.from({ length: 2_000 }, (_, index) => `closed-message-${index}`)
  }
  const state = {
    version: 3,
    tasks: [active, closed],
    graph: { entities: [] },
    cursor: {
      lastAutomaticSearchMaintenanceAt: '2026-08-04T12:00:00.000Z',
      lastAutomaticSearchMaintenanceAttemptAt: '2026-08-04T11:59:00.000Z',
      lastAutomaticSearchMaintenanceError: '等待磁盘恢复'
    }
  }
  const stored = buildEncryptedAssistantState(state)
  assert.equal(stored.tasks[0].evidence.length, 1)
  assert.equal('evidence' in stored.tasks[1], false)
  assert.equal('sourceMessageIds' in stored.tasks[1], false)
  assert.equal(stored.tasks[1].detail, '保留结构')
  assert.equal(JSON.stringify(stored).includes('closed secret'), false)
  assert.equal(state.tasks[1].evidence.length, 2_000)
  assert.deepEqual(stored.cursor, state.cursor)
  assert.deepEqual(getTaskStateStorageStats(state.tasks), {
    version: TASK_STATE_STORAGE_VERSION,
    policy: 'active_full_closed_structure_only_sqlcipher_evidence',
    tasks: 2,
    activeTasks: 1,
    closedTasks: 1,
    activeEvidenceRows: 1,
    closedEvidenceRowsOmittedOnWrite: 2_000,
    closedMessageKeysOmittedOnWrite: 2_000
  })
})
