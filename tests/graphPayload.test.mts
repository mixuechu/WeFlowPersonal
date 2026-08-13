import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGraphDashboardPayload,
  buildGraphReviewEntityPayload,
  buildUntrustedEntityReviewTargets,
  claimEntitiesAreTrusted,
  claimUntrustedEntityIds,
  eventEntitiesAreTrusted,
  eventUntrustedEntityIds,
  toGraphEntityDirectoryEntry,
  toGraphViewportEdge,
  toGraphViewportNode
} from '../shared/graphPayload.ts'

test('page-scoped entity hydration excludes summaries and unbounded evidence', () => {
  const entry = toGraphEntityDirectoryEntry({
    id: 'entity-1',
    type: 'person',
    canonicalName: 'Alice',
    aliases: Array.from({ length: 80 }, (_, index) => `alias-${index}`),
    accountIds: Array.from({ length: 40 }, (_, index) => `wxid-${index}`),
    externalIdentities: Array.from({ length: 30 }, (_, index) => ({
      platform: 'email',
      accountId: `alice-${index}@example.com`,
      displayName: `Alice ${index}`,
      confidence: 0.9
    })),
    summary: 'private profile '.repeat(10_000),
    evidenceMessageIds: Array.from({ length: 10_000 }, (_, index) => `message-${index}`),
    trustStatus: 'confirmed',
    summaryStatus: 'confirmed',
    identityVersion: 4,
    updatedAt: '2026-07-31T00:00:00.000Z'
  })
  assert.equal('summary' in entry, false)
  assert.equal('evidenceMessageIds' in entry, false)
  assert.equal(entry.aliases.length, 32)
  assert.equal(entry.accountIds.length, 16)
  assert.equal(entry.externalIdentities.length, 16)
  assert.equal(entry.trustStatus, 'confirmed')
})

test('dashboard graph payload never serializes relations, reviews or graph state internals', () => {
  const payload = buildGraphDashboardPayload([{
    id: 'entity-1',
    type: 'person',
    canonicalName: 'Alice',
    trustStatus: 'confirmed',
    summary: 'private profile'
  }])
  assert.deepEqual(Object.keys(payload).sort(), ['entities', 'relations', 'reviewQueue'])
  assert.deepEqual(payload.entities, [])
  assert.deepEqual(payload.relations, [])
  assert.deepEqual(payload.reviewQueue, [])
  assert.equal(JSON.stringify(payload).includes('private profile'), false)
})

test('dashboard graph payload stays constant when the authoritative graph has tens of thousands of entities', () => {
  const entities = Array.from({ length: 50_000 }, (_, index) => ({
    id: `entity-${index}`,
    canonicalName: `Person ${index}`,
    summary: 'private profile '.repeat(100)
  }))
  const payload = buildGraphDashboardPayload(entities)
  assert.deepEqual(payload, { entities: [], relations: [], reviewQueue: [] })
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 100)
})

test('graph viewport nodes and edges contain drawing fields but no evidence payload', () => {
  const node = toGraphViewportNode({
    id: 'a',
    type: 'person',
    canonicalName: 'Alice',
    trustStatus: 'confirmed',
    summary: 'large',
    aliases: ['A'],
    evidenceMessageIds: ['wechat:s:m']
  })
  const edge = toGraphViewportEdge({
    id: 'r',
    subjectId: 'a',
    predicate: '同事',
    objectId: 'b',
    status: 'confirmed',
    confidence: 0.8,
    evidence: [{ excerpt: 'private raw evidence' }],
    directionExplanation: 'large explanation'
  })
  assert.deepEqual(Object.keys(node).sort(), ['canonicalName', 'id', 'trustStatus', 'type'])
  assert.deepEqual(Object.keys(edge).sort(), [
    'confidence', 'id', 'objectId', 'predicate', 'status', 'subjectId'
  ])
  assert.equal(JSON.stringify([node, edge]).includes('private raw evidence'), false)
})

test('large entity directories stay bounded independently of evidence history', () => {
  const hugeEntity = {
    type: 'person',
    canonicalName: 'Person',
    aliases: Array.from({ length: 500 }, (_, index) => `alias-${index}`),
    accountIds: Array.from({ length: 500 }, (_, index) => `account-${index}`),
    externalIdentities: [],
    evidenceMessageIds: Array.from({ length: 5_000 }, (_, index) => `message-${index}`),
    summary: 'profile '.repeat(5_000),
    trustStatus: 'confirmed',
    summaryStatus: 'confirmed'
  }
  const directory = Array.from({ length: 5_000 }, (_, index) =>
    toGraphEntityDirectoryEntry({ ...hugeEntity, id: `entity-${index}` }))
  assert.ok(Buffer.byteLength(JSON.stringify(directory)) < 5 * 1024 * 1024)
})

test('review pages hydrate only related entities and cap same-name hints', () => {
  const entities = Array.from({ length: 50_000 }, (_, index) => ({
    id: `entity-${index}`,
    type: 'person',
    canonicalName: index < 100 ? '王伟' : `Person ${index}`,
    trustStatus: index === 8 ? 'rejected' : 'confirmed',
    summary: 'private profile '.repeat(1_000),
    evidenceMessageIds: Array.from({ length: 100 }, (_, evidenceIndex) => `m-${evidenceIndex}`)
  }))
  const payload = buildGraphReviewEntityPayload(
    entities,
    {
      kind: 'entity_creation',
      entityId: 'entity-0',
      entityCanonicalName: '王伟',
      leftEntityId: 'entity-1',
      rightEntityId: 'entity-2'
    },
    { subjectId: 'entity-3', objectId: 'entity-4' },
    {
      before_subject_id: 'entity-5',
      before_object_id: 'entity-6',
      after_subject_id: 'entity-7',
      after_object_id: 'entity-9'
    }
  )
  assert.deepEqual(new Set(payload.relatedEntities.map(item => item.id)), new Set([
    'entity-0', 'entity-1', 'entity-2', 'entity-3', 'entity-4',
    'entity-5', 'entity-6', 'entity-7', 'entity-9'
  ]))
  assert.equal(payload.sameNameEntities.length, 20)
  assert.equal(payload.sameNameEntityTotal, 98)
  assert.equal(JSON.stringify(payload).includes('private profile'), false)
  assert.equal(JSON.stringify(payload).includes('m-0'), false)
})

test('claim and event review actions use server-hydrated trusted entity flags', () => {
  const trusted = new Set(['person-a', 'person-b'])
  assert.equal(claimEntitiesAreTrusted({
    subject_id: 'person-a',
    object_entity_id: 'person-b'
  }, trusted), true)
  assert.equal(claimEntitiesAreTrusted({
    subject_id: 'person-a',
    object_entity_id: 'candidate'
  }, trusted), false)
  assert.equal(claimEntitiesAreTrusted({ object_entity_id: 'person-b' }, trusted), false)
  assert.equal(eventEntitiesAreTrusted({
    participants: [{ entity_id: 'person-a' }, { entity_id: 'person-b' }]
  }, trusted), true)
  assert.equal(eventEntitiesAreTrusted({
    participants: [{ entity_id: 'person-a' }, { entity_id: 'candidate' }]
  }, trusted), false)
  assert.deepEqual(claimUntrustedEntityIds({
    subject_id: 'candidate',
    object_entity_id: 'candidate'
  }, trusted), ['candidate'])
  assert.deepEqual(claimUntrustedEntityIds({ object_entity_id: 'person-b' }, trusted), [])
  assert.deepEqual(eventUntrustedEntityIds({
    participants: [
      { entity_id: 'person-a' },
      { entity_id: 'candidate-b' },
      { entity_id: 'candidate-b' },
      { entity_id: 'candidate-c' }
    ]
  }, trusted), ['candidate-b', 'candidate-c'])
  assert.deepEqual(buildUntrustedEntityReviewTargets(
    ['candidate-b', 'candidate-b', 'rejected-c', 'missing-d'],
    [{ id: 'candidate-b', canonicalName: '候选乙', trustStatus: 'candidate' },
      { id: 'rejected-c', canonicalName: '已拒绝丙', trustStatus: 'rejected' }],
    2
  ), {
    items: [
      { id: 'candidate-b', canonicalName: '候选乙', trustStatus: 'candidate' },
      { id: 'rejected-c', canonicalName: '已拒绝丙', trustStatus: 'rejected' }
    ],
    total: 3
  })
})
