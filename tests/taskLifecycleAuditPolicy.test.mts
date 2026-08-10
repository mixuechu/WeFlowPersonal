import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planTaskLifecycleAuditDecision,
  selectTaskLifecycleAuditEvidence
} from '../electron/services/taskLifecycleAuditPolicy.ts'

const base = {
  currentExists: true,
  currentStatus: 'todo',
  currentMutationToken: 'same',
  expectedMutationToken: 'same',
  allowedEvidenceIds: ['task:e1']
}

test('lifecycle audit closes only a high-confidence grounded terminal decision', () => {
  assert.deepEqual(planTaskLifecycleAuditDecision({
    ...base,
    decision: { lifecycle: 'completed', confidence: 0.95, evidenceIds: ['task:e1'] }
  }), {
    action: 'close', status: 'done', reason: 'model_lifecycle_audit_completed_v1', evidenceIds: ['task:e1']
  })
  assert.equal(planTaskLifecycleAuditDecision({
    ...base,
    decision: { lifecycle: 'cancelled', confidence: 0.95, evidenceIds: ['task:e1'] }
  }).status, 'cancelled')
})

test('lifecycle audit keeps open, low-confidence and invented-evidence decisions', () => {
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'open', confidence: 1, evidenceIds: ['task:e1'] }
  }).action, 'keep')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'completed', confidence: 0.89, evidenceIds: ['task:e1'] }
  }).action, 'keep')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'completed', confidence: 1, evidenceIds: ['invented'] }
  }).action, 'keep')
})

test('lifecycle audit skips stale, missing and already terminal tasks', () => {
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentMutationToken: 'changed', decision: {}
  }).action, 'skip')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentExists: false, decision: {}
  }).action, 'skip')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentStatus: 'done', decision: {}
  }).action, 'skip')
})

test('lifecycle audit evidence keeps task origin and recent outcome within a hard budget', () => {
  const selected = selectTaskLifecycleAuditEvidence(Array.from({ length: 50 }, (_, index) => index), 20)
  assert.deepEqual(selected.slice(0, 5), [0, 1, 2, 3, 4])
  assert.deepEqual(selected.slice(-3), [47, 48, 49])
  assert.equal(selected.length, 20)
})
