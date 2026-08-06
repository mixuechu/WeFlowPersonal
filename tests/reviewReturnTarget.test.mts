import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectReviewReturnTarget,
  resolveCompletedReviewReturn
} from '../src/utils/reviewReturnTarget.ts'

test('project review return targets retain only stable project and review identities', () => {
  assert.deepEqual(
    buildProjectReviewReturnTarget(' project-stable-id ', ' review-stable-id '),
    {
      kind: 'project',
      projectId: 'project-stable-id',
      reviewId: 'review-stable-id'
    }
  )
  assert.equal(buildProjectReviewReturnTarget('', 'review-id'), null)
  assert.equal(buildProjectReviewReturnTarget('project-id', '  '), null)
})

test('only the exact completed review may consume its current project return target', () => {
  const target = buildProjectReviewReturnTarget('project-1', 'review-new')
  assert.equal(resolveCompletedReviewReturn(target, 'review-new'), 'project-1')
  assert.equal(resolveCompletedReviewReturn(target, 'review-old'), '')
  assert.equal(resolveCompletedReviewReturn(null, 'review-new'), '')
})
