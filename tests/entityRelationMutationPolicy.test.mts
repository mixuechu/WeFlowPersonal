import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertEntityRelationMutationRevision,
  entityRelationMutationRevision
} from '../electron/services/entityRelationMutationPolicy.ts'

test('entity relationship mutations bind graph reviews and structured evidence together', () => {
  const revision = entityRelationMutationRevision('17', '29')
  assert.equal(revision, '17:29')
  assert.equal(assertEntityRelationMutationRevision(revision, '17', '29'), revision)
  assert.throws(
    () => assertEntityRelationMutationRevision(revision, '18', '29'),
    /关系档案在展示后发生了变化/
  )
  assert.throws(
    () => assertEntityRelationMutationRevision(revision, '17', '30'),
    /关系档案在展示后发生了变化/
  )
  assert.throws(
    () => assertEntityRelationMutationRevision('', '17', '29'),
    /关系档案在展示后发生了变化/
  )
})
