import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTaskOwnershipMutationRevision } from '../electron/services/taskOwnershipMutationPolicy.ts'

test('task ownership mutation accepts only the exact visible revision', () => {
  assert.doesNotThrow(() => assertTaskOwnershipMutationRevision('108', '108'))
  assert.throws(() => assertTaskOwnershipMutationRevision('', '108'), /刷新后重新确认/)
  assert.throws(() => assertTaskOwnershipMutationRevision('107', '108'), /刷新后重新确认/)
  assert.throws(() => assertTaskOwnershipMutationRevision('108', ''), /刷新后重新确认/)
})
