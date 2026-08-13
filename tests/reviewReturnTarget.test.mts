import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEntityReviewReturnTarget,
  buildProjectReviewReturnTarget,
  isSameReviewReturnTarget,
  resolveCompletedReviewReturn
} from '../src/utils/reviewReturnTarget.ts'

test('project review return targets retain only stable project and review identities', () => {
  assert.deepEqual(
    buildProjectReviewReturnTarget(' project-stable-id ', ' review-stable-id '),
    {
      kind: 'project',
      sourceId: 'project-stable-id',
      reviewId: 'review-stable-id'
    }
  )
  assert.equal(buildProjectReviewReturnTarget('', 'review-id'), null)
  assert.equal(buildProjectReviewReturnTarget('project-id', '  '), null)
})

test('entity review return targets retain stable entity and review identities', () => {
  assert.deepEqual(
    buildEntityReviewReturnTarget(' entity-stable-id ', ' review-stable-id '),
    {
      kind: 'entity',
      sourceId: 'entity-stable-id',
      reviewId: 'review-stable-id'
    }
  )
  assert.equal(buildEntityReviewReturnTarget('', 'review-id'), null)
  assert.equal(buildEntityReviewReturnTarget('entity-id', ''), null)
})

test('only the exact completed review may consume its current return target', () => {
  const target = buildProjectReviewReturnTarget('project-1', 'review-new')
  assert.deepEqual(resolveCompletedReviewReturn(target, 'review-new'), target)
  assert.equal(resolveCompletedReviewReturn(target, 'review-old'), null)
  assert.equal(resolveCompletedReviewReturn(null, 'review-new'), null)
})

test('late validation responses cannot restore a replaced source target', () => {
  const entityTarget = buildEntityReviewReturnTarget('entity-1', 'review-1')
  const projectTarget = buildProjectReviewReturnTarget('project-1', 'review-2')
  assert.equal(isSameReviewReturnTarget(entityTarget, entityTarget), true)
  assert.equal(isSameReviewReturnTarget(entityTarget, projectTarget), false)
  assert.equal(isSameReviewReturnTarget(entityTarget, null), false)
})
