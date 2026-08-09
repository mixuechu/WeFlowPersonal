import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTIVE_TASK_STATE_EVIDENCE_LIMIT,
  ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT,
  TASK_STATE_STORAGE_VERSION,
  buildEncryptedAssistantState,
  getTaskStateStorageStats
} from '../shared/taskStateStorage.ts'

test('encrypted assistant state bounds active evidence and omits closed evidence copies', () => {
  const active = {
    id: 'active', status: 'todo', title: '进行中',
    evidence: Array.from({ length: 2_500 }, (_, index) => ({
      sourceId: index % 2 ? 'wechat' : 'mail', sessionId: `active-session-${index % 3}`,
      messageId: `active-message-${index}`, timestamp: index,
      excerpt: `active secret ${index}`
    })),
    sourceMessageIds: Array.from({ length: 2_500 }, (_, index) => `active-message-${index}`)
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
    graph: {
      entities: [],
      reviewQueue: [{
        id: 'pending-review', status: 'pending', evidenceTotal: 2_500,
        evidence: Array.from({ length: 2_500 }, (_, index) => ({
          sourceId: 'wechat', sessionId: 'session', messageId: `review-${index}`,
          timestamp: index, excerpt: `pending review secret ${index}`
        }))
      }, {
        id: 'resolved-review', status: 'confirmed',
        evidence: [{ messageId: 'resolved-message', excerpt: 'resolved review secret' }]
      }]
    },
    cursor: {
      lastAutomaticSearchMaintenanceAt: '2026-08-04T12:00:00.000Z',
      lastAutomaticSearchMaintenanceAttemptAt: '2026-08-04T11:59:00.000Z',
      lastAutomaticSearchMaintenanceError: '等待磁盘恢复'
    }
  }
  const stored = buildEncryptedAssistantState(state)
  assert.equal(stored.tasks[0].evidence.length, ACTIVE_TASK_STATE_EVIDENCE_LIMIT)
  assert.equal(stored.tasks[0].evidenceTotal, 2_500)
  assert.equal(stored.tasks[0].evidence[0].messageId, 'active-message-2450')
  assert.equal(stored.tasks[0].evidence.at(-1).messageId, 'active-message-2499')
  assert.equal(stored.tasks[0].sourceMessageIds.length, ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT)
  assert.equal(stored.tasks[0].sourceMessageIds[0], 'active-message-2450')
  assert.equal('evidence' in stored.tasks[1], false)
  assert.equal('sourceMessageIds' in stored.tasks[1], false)
  assert.equal(stored.tasks[1].detail, '保留结构')
  assert.equal(JSON.stringify(stored).includes('closed secret'), false)
  assert.equal(JSON.stringify(stored).includes('active secret 1"'), false)
  assert.equal(stored.graph.reviewQueue.length, 1)
  assert.equal(stored.graph.reviewQueue[0].id, 'pending-review')
  assert.equal(stored.graph.reviewQueue[0].evidence.length, 20)
  assert.equal(stored.graph.reviewQueue[0].evidenceTotal, 2_500)
  assert.equal(stored.graph.reviewQueue[0].evidence[0].messageId, 'review-2499')
  assert.equal(JSON.stringify(stored).includes('pending review secret 1"'), false)
  assert.equal(JSON.stringify(stored).includes('resolved review secret'), false)
  assert.equal(state.graph.reviewQueue[0].evidence.length, 2_500)
  assert.equal(state.tasks[1].evidence.length, 2_000)
  assert.equal(state.tasks[0].evidence.length, 2_500)
  assert.deepEqual(stored.cursor, state.cursor)
  assert.deepEqual(getTaskStateStorageStats(state.tasks), {
    version: TASK_STATE_STORAGE_VERSION,
    policy: 'active_evidence_hotset_closed_structure_only_sqlcipher_authority',
    tasks: 2,
    activeTasks: 1,
    closedTasks: 1,
    activeEvidenceLimit: ACTIVE_TASK_STATE_EVIDENCE_LIMIT,
    activeMessageKeyLimit: ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT,
    activeEvidenceRows: ACTIVE_TASK_STATE_EVIDENCE_LIMIT,
    activeEvidenceRowsOmittedOnWrite: 2_450,
    closedEvidenceRowsOmittedOnWrite: 2_000,
    closedMessageKeysOmittedOnWrite: 2_000
  })
  const missingEvidence = buildEncryptedAssistantState({
    tasks: [{ id: 'needs-hydration', status: 'todo', evidenceTotal: 12 }],
    graph: { reviewQueue: [] }
  }).tasks[0]
  assert.equal('evidence' in missingEvidence, false)
  assert.equal(missingEvidence.evidenceTotal, 12)
})
