import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCrossStoreRecoveryAbandon,
  buildCrossStoreRecoveryAbandonToken,
  type CrossStoreRecoveryAbandonIdentity
} from '../electron/services/crossStoreRecoveryAbandonPolicy.ts'

const identity: CrossStoreRecoveryAbandonIdentity = {
  kind: 'task',
  commitId: 'commit-1',
  preparedPayloadSha256: 'a'.repeat(64),
  currentStateSha256: 'b'.repeat(64),
  recoveryAttempts: 2
}

test('cross-store abandon binds the prepared payload and current state', () => {
  const previewToken = buildCrossStoreRecoveryAbandonToken(identity)
  assert.doesNotThrow(() => assertCrossStoreRecoveryAbandon(identity, {
    previewToken,
    confirmation: '保留当前状态'
  }))
  assert.throws(() => assertCrossStoreRecoveryAbandon({
    ...identity,
    currentStateSha256: 'c'.repeat(64)
  }, { previewToken, confirmation: '保留当前状态' }), /重新预览/)
  assert.throws(() => assertCrossStoreRecoveryAbandon(identity, {
    previewToken,
    confirmation: '放弃'
  }), /保留当前状态/)
})
