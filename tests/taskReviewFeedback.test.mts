import assert from 'node:assert/strict'
import test from 'node:test'
import { applyTaskReviewFeedback, taskEvidenceFingerprint } from '../electron/services/taskReviewFeedback.ts'

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
