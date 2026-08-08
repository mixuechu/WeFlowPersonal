import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTaskReviewFeedback,
  reconcileTasksWithReviewDecisions,
  taskEvidenceFingerprint,
  taskReviewRestoreClassification
} from '../electron/services/taskReviewFeedback.ts'

test('task feedback fingerprint follows evidence rather than model wording', () => {
  const first = taskEvidenceFingerprint({
    title: '查一下几点更新',
    sourceSessionId: 'group-1',
    sourceMessageIds: ['wechat:group-1:123']
  })
  const reformulated = taskEvidenceFingerprint({
    title: '确认更新时间',
    sourceSessionId: 'group-1',
    evidence: [{ messageId: 'wechat:group-1:123' }]
  })
  assert.equal(first, reformulated)
  assert.notEqual(first, taskEvidenceFingerprint({
    title: '确认更新时间',
    sourceSessionId: 'group-1',
    sourceMessageIds: ['wechat:group-1:124']
  }))
})

test('task feedback rejects repeated evidence and restores confirmed ownership', () => {
  const candidate = { title: '待确认事项', classification: 'uncertain', ownershipPolicyReason: '模型不确定' }
  assert.equal(applyTaskReviewFeedback(candidate, { decision: 'rejected' }), null)
  assert.deepEqual(applyTaskReviewFeedback(candidate, { decision: 'mine' }), {
    title: '待确认事项',
    classification: 'mine',
    ownershipPolicyReason: '相同原文证据此前已由用户确认为我的待办'
  })
  assert.equal(applyTaskReviewFeedback(candidate, null), candidate)
})

test('reverting ownership feedback restores the classification captured before review', () => {
  assert.equal(taskReviewRestoreClassification({ classification: 'mine' }), 'mine')
  assert.equal(taskReviewRestoreClassification({ classification: 'uncertain' }), 'uncertain')
  assert.equal(taskReviewRestoreClassification({ classification: 'others' }), 'others')
  assert.equal(taskReviewRestoreClassification({ classification: 'rejected' }), 'uncertain')
  assert.equal(taskReviewRestoreClassification(null), 'uncertain')
})

test('startup reconciliation replays exact evidence decisions after an interrupted state save', () => {
  const rejectedTask = {
    id: 'rejected',
    title: '查一下几点更新',
    sourceSessionId: 'group-1',
    sourceMessageIds: ['message-1'],
    classification: 'uncertain'
  }
  const confirmedTask = {
    id: 'confirmed',
    title: '给客户回复',
    sourceSessionId: 'group-2',
    sourceMessageIds: ['message-2'],
    classification: 'uncertain'
  }
  const restoredTask = {
    id: 'restored',
    title: '整理合同',
    sourceSessionId: 'group-3',
    sourceMessageIds: ['message-3'],
    classification: 'uncertain'
  }
  const result = reconcileTasksWithReviewDecisions([rejectedTask, confirmedTask], [{
    evidence_fingerprint: taskEvidenceFingerprint(rejectedTask),
    decision: 'rejected',
    task: rejectedTask
  }, {
    evidence_fingerprint: taskEvidenceFingerprint(confirmedTask),
    decision: 'mine',
    task: confirmedTask
  }, {
    evidence_fingerprint: taskEvidenceFingerprint(restoredTask),
    decision: 'mine',
    task: restoredTask
  }])

  assert.deepEqual(result.tasks.map(task => task.id), ['restored', 'confirmed'])
  assert.equal(result.tasks.every(task => task.classification === 'mine'), true)
  assert.deepEqual(result.effects.map(effect => effect.action).sort(), ['confirmed', 'removed', 'restored'])
  assert.equal(result.checked, 3)
})

test('startup reconciliation ignores revoked and different evidence decisions', () => {
  const task = {
    id: 'new-evidence',
    title: '准备资料',
    sourceSessionId: 'group-1',
    sourceMessageIds: ['message-new'],
    classification: 'uncertain'
  }
  const result = reconcileTasksWithReviewDecisions([task], [{
    evidence_fingerprint: taskEvidenceFingerprint({ ...task, sourceMessageIds: ['message-old'] }),
    decision: 'rejected',
    task
  }, {
    evidence_fingerprint: taskEvidenceFingerprint(task),
    decision: 'rejected',
    revoked_at: '2026-07-30T00:00:00.000Z',
    task
  }])
  assert.deepEqual(result.tasks, [task])
  assert.deepEqual(result.effects, [])
  assert.equal(result.checked, 1)
})
