import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMemorySearchFeedbackMutationToken
} from '../electron/services/memorySearchFeedbackMutationPolicy.ts'

const identity = {
  queryFingerprint: 'query-a',
  scopeFingerprint: 'scope-a',
  documentId: 'claim:one',
  documentType: 'claim',
  sourceId: 'one',
  contentHash: 'content-a',
  evidenceAuthorityRevision: 4,
  currentAction: ''
}

test('feedback mutation token is stable for an unchanged visible result', () => {
  assert.equal(
    buildMemorySearchFeedbackMutationToken(identity),
    buildMemorySearchFeedbackMutationToken({ ...identity })
  )
})

test('feedback mutation token changes with result, evidence, scope or current decision', () => {
  const original = buildMemorySearchFeedbackMutationToken(identity)
  for (const changed of [
    { documentId: 'claim:two' },
    { contentHash: 'content-b' },
    { evidenceAuthorityRevision: 5 },
    { scopeFingerprint: 'scope-b' },
    { currentAction: 'helpful' }
  ]) {
    assert.notEqual(
      buildMemorySearchFeedbackMutationToken({ ...identity, ...changed }),
      original
    )
  }
})
