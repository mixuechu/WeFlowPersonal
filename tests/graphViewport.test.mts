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
