import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGraphReviewPageScopeToken,
  normalizeGraphReviewPageScope
} from '../electron/services/graphReviewPageScope.ts'

test('graph review scope normalization matches the SQLCipher directory contract', () => {
  assert.deepEqual(normalizeGraphReviewPageScope({
    status: 'invalid' as any,
    kind: ' relation ',
    query: '  李石头  ',
    reviewId: ' review-1 ',
    entityId: ' entity-1 ',
    calibrationOutcome: 'invalid' as any,
    reasonCode: ' identity '
  }), {
    status: 'pending',
    kind: 'relation',
    query: '李石头',
    reviewId: 'review-1',
    entityId: 'entity-1',
    calibrationOutcome: '',
    reasonCode: 'identity'
  })
})

test('graph review continuation token binds every effective directory filter', () => {
  const baseOptions = {
    status: 'pending' as const,
    kind: 'relation',
    query: '方向',
    reviewId: 'review-1',
    entityId: 'entity-1',
    calibrationOutcome: 'rejected' as const,
    reasonCode: 'relation'
  }
  const base = buildGraphReviewPageScopeToken(baseOptions).token
  const variants = Object.entries(baseOptions).map(([key, value]) =>
    buildGraphReviewPageScopeToken({
      ...baseOptions,
      [key]: key === 'status' ? 'resolved'
        : key === 'calibrationOutcome' ? 'corrected'
          : `${value}-changed`
    } as any).token)
  assert.equal(new Set([base, ...variants]).size, variants.length + 1)
  assert.equal(base, buildGraphReviewPageScopeToken({
    ...baseOptions,
    query: '  方向  '
  }).token)
})
