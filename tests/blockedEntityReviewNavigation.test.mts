import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockedEntityReviewScope,
  shouldReturnToBlockedRelationReview
} from '../src/utils/blockedEntityReviewNavigation.ts'

const target = {
  reviewId: 'relation-review',
  title: '甲 — 合作 → 乙',
  entityIds: ['entity-a', 'entity-b']
}

test('returns only after reviewing a blocked relation endpoint identity', () => {
  assert.equal(shouldReturnToBlockedRelationReview(target, {
    id: 'entity-review-a',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), true)
  assert.equal(shouldReturnToBlockedRelationReview(target, {
    id: 'unrelated-identity-review',
    kind: 'entity_creation',
    entityId: 'entity-c'
  }), false)
})

test('does not treat other review kinds or the original relation as endpoint work', () => {
  assert.equal(shouldReturnToBlockedRelationReview(target, {
    id: 'duplicate-review',
    kind: 'possible_duplicate',
    entityId: 'entity-a'
  }), false)
  assert.equal(shouldReturnToBlockedRelationReview(target, {
    id: 'relation-review',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), false)
  assert.equal(shouldReturnToBlockedRelationReview(null, {
    id: 'entity-review-a',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), false)
})

test('all blocked identities use the exact entity review kind and preserve history when needed', () => {
  assert.deepEqual(blockedEntityReviewScope({
    untrusted_entity_review_targets: [
      { id: 'entity-a', trustStatus: 'candidate' },
      { id: 'entity-a', trustStatus: 'candidate' },
      { id: 'entity-b', trustStatus: 'candidate' }
    ]
  }), { status: 'pending', entityIds: ['entity-a', 'entity-b'] })
  assert.deepEqual(blockedEntityReviewScope({
    untrusted_entity_review_targets: [
      { id: 'entity-a', trustStatus: 'candidate' },
      { id: 'entity-b', trustStatus: 'rejected' }
    ]
  }), { status: 'all', entityIds: ['entity-a', 'entity-b'] })
  assert.deepEqual(blockedEntityReviewScope(undefined), {
    status: 'pending',
    entityIds: []
  })
})
