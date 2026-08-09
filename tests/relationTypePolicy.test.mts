import test from 'node:test'
import assert from 'node:assert/strict'
import {
  quarantineInvalidRelationTypes,
  relationTypeViolation
} from '../electron/services/relationTypePolicy.ts'
import { planRelationConfirmation } from '../electron/services/relationCorrectionPolicy.ts'

const entities = [
  { id: 'person-a', type: 'person', canonicalName: '甲', trustStatus: 'confirmed' },
  { id: 'person-b', type: 'person', canonicalName: '乙', trustStatus: 'confirmed' },
  { id: 'org', type: 'organization', canonicalName: '机构', trustStatus: 'confirmed' }
]

test('invalid person-only relations are quarantined without losing evidence', () => {
  const relation = {
    id: 'invalid-friend',
    subjectId: 'org',
    predicate: '朋友',
    objectId: 'person-a',
    status: 'confirmed',
    evidence: [{ messageId: 'wechat:session:1', excerpt: '原文证据' }],
    evidenceTotal: 1,
    updatedAt: 'before'
  }
  const result = quarantineInvalidRelationTypes(
    [relation],
    entities,
    '2026-08-04T00:00:00.000Z'
  )
  assert.deepEqual(result.invalidRelationIds, ['invalid-friend'])
  assert.equal(result.changed, 1)
  assert.equal(result.relations.length, 1)
  assert.equal(result.relations[0].status, 'candidate')
  assert.equal(result.relations[0].evidence[0].excerpt, '原文证据')
  assert.match(String(relationTypeViolation(result.relations[0], entities)), /不是人物/)
})

test('rejected invalid relations stay terminal and valid person relations are untouched', () => {
  const rejected = {
    id: 'rejected',
    subjectId: 'org',
    predicate: '同学',
    objectId: 'person-a',
    status: 'rejected'
  }
  const valid = {
    id: 'valid',
    subjectId: 'person-a',
    predicate: '同学',
    objectId: 'person-b',
    status: 'confirmed'
  }
  const result = quarantineInvalidRelationTypes([rejected, valid], entities, 'later')
  assert.equal(result.changed, 0)
  assert.equal(result.relations[0], rejected)
  assert.equal(result.relations[1], valid)
  assert.equal(relationTypeViolation(valid, entities), null)
})

test('relation confirmation requires a type-valid correction', () => {
  const relation = {
    id: 'invalid-friend',
    subjectId: 'org',
    predicate: '朋友',
    objectId: 'person-a',
    status: 'candidate'
  }
  const review = { kind: 'relation', relationId: relation.id }
  assert.throws(() => planRelationConfirmation({
    review,
    relation,
    entities
  }), /不是人物/)
  const corrected = planRelationConfirmation({
    review,
    relation,
    entities,
    correction: { predicate: '服务对象' }
  })
  assert.equal(corrected.after.predicate, '服务对象')
  assert.equal(corrected.changed, true)
})

test('large relation quarantine builds the entity index once instead of once per relation', () => {
  const entityCount = 50_000
  const relationCount = 100_000
  let entityMapCalls = 0
  const largeEntities = new Proxy(
    Array.from({ length: entityCount }, (_, index) => ({
      id: `entity-${index}`,
      type: index % 5 === 0 ? 'organization' : 'person'
    })),
    {
      get(target, property, receiver) {
        if (property === 'map') {
          return (...args: Parameters<Array<(typeof target)[number]>['map']>) => {
            entityMapCalls += 1
            return target.map(...args)
          }
        }
        return Reflect.get(target, property, receiver)
      }
    }
  )
  const relations = Array.from({ length: relationCount }, (_, index) => ({
    id: `relation-${index}`,
    subjectId: `entity-${index % entityCount}`,
    predicate: index % 2 === 0 ? '朋友' : '服务对象',
    objectId: `entity-${(index + 1) % entityCount}`,
    status: 'confirmed',
    updatedAt: 'before'
  }))
  const startedAt = performance.now()
  const result = quarantineInvalidRelationTypes(relations, largeEntities, 'after')
  const durationMs = performance.now() - startedAt

  assert.equal(entityMapCalls, 1)
  assert.equal(result.invalidRelationIds.length, 20_000)
  assert.equal(result.changed, 20_000)
  assert.ok(durationMs < 3_000, `indexed 100k-relation pass took ${durationMs.toFixed(1)}ms`)
})
