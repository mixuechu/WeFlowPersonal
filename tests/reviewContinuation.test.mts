import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planReviewContinuation,
  resolveReviewContinuation
} from '../src/utils/reviewContinuation.ts'

const pending = (id: string) => ({ id, status: 'pending' })

test('continuous review prefers the next pending item in visible order', () => {
  const plan = planReviewContinuation(
    [pending('a'), pending('b'), pending('c')],
    'b',
    9
  )
  assert.deepEqual(plan, {
    completedId: 'b',
    preferredId: 'c',
    remaining: 8
  })
  assert.equal(resolveReviewContinuation(plan, [pending('a'), pending('c')]), 'c')
})

test('the last visible item wraps to the first remaining pending item', () => {
  const plan = planReviewContinuation([pending('a'), pending('b')], 'b', 2)
  assert.equal(plan?.preferredId, 'a')
  assert.equal(resolveReviewContinuation(plan, [pending('a')]), 'a')
})

test('a refreshed page safely falls back when pagination replaces the preferred item', () => {
  const plan = planReviewContinuation([pending('a')], 'a', 41)
  assert.equal(plan?.preferredId, '')
  assert.equal(plan?.remaining, 40)
  assert.equal(resolveReviewContinuation(plan, [pending('page-two-first')]), 'page-two-first')
})

test('an emptied queue has no continuation target', () => {
  const plan = planReviewContinuation([pending('only')], 'only', 1)
  assert.equal(resolveReviewContinuation(plan, []), '')
  assert.equal(plan?.remaining, 0)
})
