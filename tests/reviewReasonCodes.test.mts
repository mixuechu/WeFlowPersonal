import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeReviewReasonCode,
  reviewReasonOptions,
  REVIEW_REASON_CODES,
  REVIEW_REASON_LABELS
} from '../shared/reviewReasonCodes.ts'

test('review reason codes are fixed, labeled and domain constrained', () => {
  assert.equal(new Set(REVIEW_REASON_CODES).size, REVIEW_REASON_CODES.length)
  for (const code of REVIEW_REASON_CODES) assert.ok(REVIEW_REASON_LABELS[code])
  assert.equal(normalizeReviewReasonCode('task', 'incorrect_assignment'), 'incorrect_assignment')
  assert.equal(normalizeReviewReasonCode('memory', 'incorrect_assignment'), 'unspecified')
  assert.equal(normalizeReviewReasonCode('graph', 'wrong_relation'), 'wrong_relation')
  assert.equal(normalizeReviewReasonCode('identity', 'identity_mismatch'), 'identity_mismatch')
  assert.equal(normalizeReviewReasonCode('task', '../../secret'), 'unspecified')
  assert.ok(reviewReasonOptions('memory').every(option => option.code !== 'unspecified'))
})
