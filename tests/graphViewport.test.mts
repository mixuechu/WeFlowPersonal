import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGraphViewport } from '../src/utils/graphViewport.ts'

const entities = Array.from({ length: 80 }, (_, index) => ({
  id: `entity-${index}`,
  canonicalName: index === 70 ? '目标人物' : `人物 ${index}`,
  aliases: index === 70 ? ['目标别名'] : [],
  accountIds: [],
  trustStatus: 'confirmed',
  updatedAt: new Date(1_700_000_000_000 + index).toISOString()
}))
const relations = Array.from({ length: 79 }, (_, index) => ({
  id: `relation-${index}`,
  subjectId: `entity-${index}`,
  objectId: `entity-${index + 1}`,
  predicate: '认识',
  status: 'confirmed',
  confidence: 0.9
}))

test('graph viewport prioritizes connected entities instead of the last inserted slice', () => {
  const hubRelations = [
    ...relations,
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `hub-${index}`,
      subjectId: 'entity-1',
      objectId: `entity-${20 + index}`,
      predicate: '合作',
      status: 'confirmed',
      confidence: 0.8
    }))
  ]
  const viewport = buildGraphViewport(entities, hubRelations, { maxNodes: 20 })
  assert.equal(viewport.mode, 'overview')
  assert.equal(viewport.entities.length, 20)
  assert.ok(viewport.entities.some(entity => entity.id === 'entity-1'))
  assert.equal(viewport.truncated, 60)
  assert.equal(viewport.totalAvailable, 80)
  assert.equal(viewport.totalRelationsAvailable, hubRelations.length)
  assert.equal(viewport.truncatedRelations,
    viewport.totalRelationsAvailable - viewport.relations.length)
})

test('graph viewport keeps search matches and expands bounded multi-hop context', () => {
  const viewport = buildGraphViewport(entities, relations, {
    query: '目标别名',
    depth: 2,
    maxNodes: 20
  })
  assert.equal(viewport.mode, 'search')
  assert.deepEqual(viewport.entities.map(entity => entity.id).sort(), [
    'entity-68', 'entity-69', 'entity-70', 'entity-71', 'entity-72'
  ])
  assert.equal(viewport.relations.length, 4)
  assert.equal(viewport.totalAvailable, 5)
  assert.equal(viewport.totalRelationsAvailable, 4)
  assert.equal(viewport.matchingSeeds, 1)
  assert.equal(viewport.levels.get('entity-70'), 0)
  assert.equal(viewport.levels.get('entity-68'), 2)
})

test('graph viewport centers an explicit focus and obeys relation filters', () => {
  const mixedRelations = [...relations, {
    id: 'candidate-shortcut',
    subjectId: 'entity-10',
    objectId: 'entity-70',
    predicate: '合作',
    status: 'candidate',
    confidence: 0.7
  }]
  const viewport = buildGraphViewport(entities, mixedRelations, {
    focusEntityId: 'entity-70',
    relationStatus: 'confirmed',
    depth: 1,
    maxNodes: 20
  })
  assert.equal(viewport.mode, 'focus')
  assert.deepEqual(viewport.entities.map(entity => entity.id).sort(), ['entity-69', 'entity-70', 'entity-71'])
  assert.ok(viewport.relations.every(relation => relation.status === 'confirmed'))
})

test('graph viewport keeps multi-year graph payload bounded independently of total relations', () => {
  const largeEntities = Array.from({ length: 5_000 }, (_, index) => ({
    id: `large-entity-${index}`,
    canonicalName: `长期人物 ${index}`,
    aliases: [],
    accountIds: [],
    trustStatus: 'confirmed',
    updatedAt: new Date(1_700_000_000_000 + index).toISOString()
  }))
  const largeRelations = Array.from({ length: 4_999 }, (_, index) => ({
    id: `large-relation-${index}`,
    subjectId: `large-entity-${index}`,
    objectId: `large-entity-${index + 1}`,
    predicate: '长期协作',
    status: 'confirmed',
    confidence: 0.9,
    evidence: [{ messageId: `message-${index}`, excerpt: '原文证据'.repeat(80) }]
  }))
  const viewport = buildGraphViewport(largeEntities, largeRelations, {
    focusEntityId: 'large-entity-2500',
    depth: 3,
    maxNodes: 60
  })
  assert.equal(viewport.entities.length, 7)
  assert.equal(viewport.relations.length, 6)
  assert.equal(viewport.levels.get('large-entity-2500'), 0)
  const fullBytes = Buffer.byteLength(JSON.stringify({ entities: largeEntities, relations: largeRelations }))
  const viewportBytes = Buffer.byteLength(JSON.stringify({
    entities: viewport.entities,
    relations: viewport.relations
  }))
  assert.ok(viewportBytes < fullBytes * 0.01)
})

test('graph viewport reports the complete bounded neighborhood before progressive expansion', () => {
  const first = buildGraphViewport(entities, relations, {
    focusEntityId: 'entity-40',
    depth: 3,
    maxNodes: 2
  })
  assert.equal(first.maxNodes, 10)
  assert.equal(first.totalAvailable, 7)
  assert.equal(first.totalRelationsAvailable, 6)
  assert.equal(first.entities.length, 7)
  assert.equal(first.truncated, 0)

  const longChainEntities = Array.from({ length: 700 }, (_, index) => ({
    id: `chain-${index}`,
    canonicalName: `链路 ${index}`,
    trustStatus: 'confirmed'
  }))
  const longChainRelations = Array.from({ length: 699 }, (_, index) => ({
    id: `chain-relation-${index}`,
    subjectId: `chain-${index}`,
    objectId: `chain-${index + 1}`,
    predicate: '连接',
    status: 'confirmed',
    confidence: 1
  }))
  const expanded = buildGraphViewport(longChainEntities, longChainRelations, {
    query: '链路',
    maxNodes: 999
  })
  assert.equal(expanded.maxNodes, 300)
  assert.equal(expanded.totalAvailable, 700)
  assert.equal(expanded.entities.length, 300)
  assert.equal(expanded.truncated, 400)
  assert.equal(expanded.totalRelationsAvailable, 699)
  assert.equal(expanded.truncatedRelations, 400)
})
