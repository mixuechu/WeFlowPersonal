import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockedEntityMissingGuidance,
  blockedEntityReviewScope,
  buildBlockedStructuredMemoryReturnTarget,
  shouldReturnToBlockedIdentitySource
} from '../src/utils/blockedEntityReviewNavigation.ts'

const target = {
  kind: 'relation_review' as const,
  reviewId: 'relation-review',
  title: '甲 — 合作 → 乙',
  entityIds: ['entity-a', 'entity-b']
}

test('returns only after reviewing a blocked relation endpoint identity', () => {
  assert.equal(shouldReturnToBlockedIdentitySource(target, {
    id: 'entity-review-a',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), true)
  assert.equal(shouldReturnToBlockedIdentitySource(target, {
    id: 'unrelated-identity-review',
    kind: 'entity_creation',
    entityId: 'entity-c'
  }), false)
})

test('missing identities direct each memory kind to its actual correction surface', () => {
  assert.match(blockedEntityMissingGuidance('claim'), /事实主体或对象/)
  assert.match(blockedEntityMissingGuidance('claim'), /普通值/)
  assert.match(blockedEntityMissingGuidance('event'), /选择或移除对应参与者/)
  assert.match(blockedEntityMissingGuidance('relation'), /主语或宾语选择器/)
})

test('does not treat other review kinds or the original relation as endpoint work', () => {
  assert.equal(shouldReturnToBlockedIdentitySource(target, {
    id: 'duplicate-review',
    kind: 'possible_duplicate',
    entityId: 'entity-a'
  }), false)
  assert.equal(shouldReturnToBlockedIdentitySource(target, {
    id: 'relation-review',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), false)
  assert.equal(shouldReturnToBlockedIdentitySource(null, {
    id: 'entity-review-a',
    kind: 'entity_creation',
    entityId: 'entity-a'
  }), false)
})

test('returns to an exact blocked claim or event only after its own identity review', () => {
  const memoryTarget = {
    kind: 'structured_memory' as const,
    memoryKind: 'claim' as const,
    sourceId: 'claim-42',
    title: '甲 · 任职于',
    entityIds: ['entity-a']
  }
  assert.equal(shouldReturnToBlockedIdentitySource(memoryTarget, {
    id: 'entity-review-a', kind: 'entity_creation', entityId: 'entity-a'
  }), true)
  assert.equal(shouldReturnToBlockedIdentitySource(memoryTarget, {
    id: 'entity-review-b', kind: 'entity_creation', entityId: 'entity-b'
  }), false)
  assert.equal(shouldReturnToBlockedIdentitySource(memoryTarget, {
    id: 'relation-review', kind: 'relation', entityId: 'entity-a'
  }), false)
})

test('builds stable return targets for blocked claims and events', () => {
  assert.deepEqual(buildBlockedStructuredMemoryReturnTarget('claim', {
    id: 'claim-42', subject_name: '甲', predicate: '任职于',
    untrusted_entity_review_targets: [
      { id: 'entity-a', trustStatus: 'candidate' },
      { id: 'entity-a', trustStatus: 'candidate' }
    ]
  }), {
    kind: 'structured_memory', memoryKind: 'claim', sourceId: 'claim-42',
    title: '甲 · 任职于', entityIds: ['entity-a']
  })
  assert.deepEqual(buildBlockedStructuredMemoryReturnTarget('event', {
    id: 'event-7', title: '项目复盘',
    untrusted_entity_review_targets: [{ id: 'entity-b', trustStatus: 'rejected' }]
  }), {
    kind: 'structured_memory', memoryKind: 'event', sourceId: 'event-7',
    title: '项目复盘', entityIds: ['entity-b']
  })
  assert.equal(buildBlockedStructuredMemoryReturnTarget('claim', { predicate: '缺少 ID' }), null)
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
