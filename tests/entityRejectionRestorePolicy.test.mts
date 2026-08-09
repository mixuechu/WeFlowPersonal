import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertEntityRejectionRestoreConfirmation,
  buildEntityRejectionRestorePlan,
  buildEntityRejectionRestorePreviewToken,
  ENTITY_REJECTION_CLAIM_REASON,
  ENTITY_REJECTION_EVENT_REASON,
  inspectEntityRejectionRestore,
  restoredCascadeStatus,
  type EntityRejectionCascadeSnapshot
} from '../electron/services/entityRejectionRestorePolicy.ts'

const rejectedAt = '2026-08-09T03:00:00.000Z'
const snapshot: EntityRejectionCascadeSnapshot = {
  version: 1,
  reviewId: 'entity-review',
  rejectedAt,
  entity: {
    id: 'entity-a', canonicalName: '甲', identityVersion: 3, previousTrustStatus: 'candidate'
  },
  relations: [{
    id: 'relation-a', subjectId: 'entity-a', objectId: 'entity-b', previousStatus: 'confirmed'
  }],
  memories: [
    { kind: 'claim', id: 'claim-a', previousStatus: 'confirmed', entityIds: ['entity-a'] },
    { kind: 'event', id: 'event-a', previousStatus: 'candidate', entityIds: ['entity-a'] }
  ],
  autoClosedReviewCount: 2
}

function currentInput() {
  return {
    snapshot,
    currentEntity: {
      id: 'entity-a', canonicalName: '甲', identityVersion: 3,
      trustStatus: 'rejected', updatedAt: rejectedAt
    },
    currentRelations: [{
      id: 'relation-a', subjectId: 'entity-a', objectId: 'entity-b',
      status: 'rejected', updatedAt: rejectedAt
    }],
    currentMemories: [{
      kind: 'claim' as const, id: 'claim-a', status: 'rejected', updatedAt: rejectedAt,
      latestDecision: {
        previousStatus: 'confirmed', decision: 'rejected', actor: 'system',
        reason: ENTITY_REJECTION_CLAIM_REASON, createdAt: rejectedAt
      }
    }, {
      kind: 'event' as const, id: 'event-a', status: 'rejected', updatedAt: rejectedAt,
      latestDecision: {
        previousStatus: 'candidate', decision: 'rejected', actor: 'system',
        reason: ENTITY_REJECTION_EVENT_REASON, createdAt: rejectedAt
      }
    }]
  }
}

test('a complete unchanged entity rejection cascade is safe to restore', () => {
  const result = inspectEntityRejectionRestore(currentInput())
  assert.equal(result.safe, true)
  assert.equal(result.reason, '')
  assert.deepEqual(result.counts, { relations: 1, claims: 1, events: 1, archivedReviews: 2 })
})

test('any later entity, relation or memory decision blocks the whole restore', () => {
  const changedEntity = currentInput()
  changedEntity.currentEntity.updatedAt = '2026-08-09T04:00:00.000Z'
  assert.match(inspectEntityRejectionRestore(changedEntity).reason, /实体档案/)

  const changedRelation = currentInput()
  changedRelation.currentRelations[0].status = 'candidate'
  assert.match(inspectEntityRejectionRestore(changedRelation).reason, /关联关系/)

  const changedMemory = currentInput()
  changedMemory.currentMemories[0].latestDecision!.actor = 'user'
  assert.match(inspectEntityRejectionRestore(changedMemory).reason, /事实/)
})

test('legacy rejections without a private cascade snapshot fail closed', () => {
  const result = inspectEntityRejectionRestore({ snapshot: undefined })
  assert.equal(result.safe, false)
  assert.match(result.reason, /上线前/)
})

test('restore confirmation binds both authority revisions and the exact affected state', () => {
  const identity = {
    reviewId: 'entity-review',
    graphReviewRevision: 'graph-7',
    structuredMemoryRevision: 'memory-9',
    currentFingerprint: inspectEntityRejectionRestore(currentInput()).currentFingerprint
  }
  const previewToken = buildEntityRejectionRestorePreviewToken(identity)
  assert.doesNotThrow(() => assertEntityRejectionRestoreConfirmation(identity, {
    previewToken, confirmation: '恢复身份'
  }))
  assert.throws(() => assertEntityRejectionRestoreConfirmation({
    ...identity, structuredMemoryRevision: 'memory-10'
  }, { previewToken, confirmation: '恢复身份' }), /已失效/)
})

test('confirmed downstream content is downgraded when another endpoint remains untrusted', () => {
  assert.equal(restoredCascadeStatus(
    'confirmed', ['entity-a', 'entity-b'], new Set(['entity-a'])
  ), 'candidate')
  assert.equal(restoredCascadeStatus(
    'confirmed', ['entity-a', 'entity-b'], new Set(['entity-a', 'entity-b'])
  ), 'confirmed')
  assert.equal(restoredCascadeStatus(
    'rejected', ['entity-a', 'entity-b'], new Set(['entity-a'])
  ), 'rejected')
})

test('one deterministic restore plan covers every relation and memory before writes begin', () => {
  const plan = buildEntityRejectionRestorePlan({
    snapshot: {
      ...snapshot,
      memories: [
        ...snapshot.memories,
        { kind: 'claim', id: 'claim-terminal', previousStatus: 'rejected', entityIds: ['entity-a'] }
      ]
    },
    currentRelations: currentInput().currentRelations,
    trustedEntityIds: new Set(['entity-b'])
  })
  assert.deepEqual(plan, {
    entityId: 'entity-a',
    relations: [{ id: 'relation-a', status: 'confirmed' }],
    memories: [
      { kind: 'claim', id: 'claim-a', status: 'confirmed', write: true },
      { kind: 'event', id: 'event-a', status: 'candidate', write: true },
      { kind: 'claim', id: 'claim-terminal', status: 'rejected', write: false }
    ],
    downgraded: 0
  })
})

test('restore planning fails closed before mutations when a snapshotted relation is missing', () => {
  assert.throws(() => buildEntityRejectionRestorePlan({
    snapshot,
    currentRelations: [],
    trustedEntityIds: new Set(['entity-b'])
  }), /relation-a.*不能生成身份恢复计划/)
})
