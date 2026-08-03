import assert from 'node:assert/strict'
import test from 'node:test'
import { assertGraphReviewMutationRevision } from '../electron/services/graphReviewMutationPolicy.ts'

test('graph review mutation accepts only the exact visible queue revision', () => {
  assert.doesNotThrow(() => assertGraphReviewMutationRevision('42', '42'))
  assert.throws(() => assertGraphReviewMutationRevision('', '42'), /刷新后重新确认/)
  assert.throws(() => assertGraphReviewMutationRevision('41', '42'), /刷新后重新确认/)
  assert.throws(() => assertGraphReviewMutationRevision('42', ''), /刷新后重新确认/)
})
