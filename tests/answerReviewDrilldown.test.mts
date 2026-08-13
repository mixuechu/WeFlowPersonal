import assert from 'node:assert/strict'
import test from 'node:test'
import { answerReviewDrilldownFilters } from '../src/utils/answerReviewDrilldown.ts'

test('pending and resolved answer counts drill into the attention queue', () => {
  assert.deepEqual(answerReviewDrilldownFilters('pending'), {
    status: 'attention',
    reviewState: 'pending',
    invalidReason: ''
  })
  assert.deepEqual(answerReviewDrilldownFilters('resolved'), {
    status: 'attention',
    reviewState: 'resolved',
    invalidReason: ''
  })
})

test('answer validity counts include every review decision state', () => {
  for (const target of ['attention', 'invalid', 'needs_review', 'current'] as const) {
    assert.deepEqual(answerReviewDrilldownFilters(target), {
      status: target,
      reviewState: 'all',
      invalidReason: ''
    })
  }
})
