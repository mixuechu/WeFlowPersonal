import assert from 'node:assert/strict'
import test from 'node:test'
import { assertStructuredMemoryMutationRevision } from '../electron/services/structuredMemoryMutationPolicy.ts'

test('structured memory mutation accepts only the exact visible revision', () => {
  assert.doesNotThrow(() => assertStructuredMemoryMutationRevision('42', '42'))
  assert.throws(
    () => assertStructuredMemoryMutationRevision('', '42'),
    /事实与事件档案在展示后发生了变化/
  )
  assert.throws(
    () => assertStructuredMemoryMutationRevision('41', '42'),
    /事实与事件档案在展示后发生了变化/
  )
  assert.throws(
    () => assertStructuredMemoryMutationRevision('42', ''),
    /事实与事件档案在展示后发生了变化/
  )
})
