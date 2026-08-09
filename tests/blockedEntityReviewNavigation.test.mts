import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldReturnToBlockedRelationReview } from '../src/utils/blockedEntityReviewNavigation.ts'

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
