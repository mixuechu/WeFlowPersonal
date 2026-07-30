import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGraphDashboardPayload,
  toGraphEntityDirectoryEntry,
  toGraphViewportEdge,
  toGraphViewportNode
} from '../shared/graphPayload.ts'

test('dashboard entity directory excludes summaries and unbounded evidence', () => {
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
  assert.deepEqual(payload.relations, [])
  assert.deepEqual(payload.reviewQueue, [])
  assert.equal(JSON.stringify(payload).includes('private profile'), false)
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
