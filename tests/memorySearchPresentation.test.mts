import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceLocalMessageId,
  groupMemorySearchResults,
  normalizeMemoryEvidence
} from '../src/utils/memorySearchPresentation.ts'

test('memory search presentation groups results in a stable semantic order', () => {
  const groups = groupMemorySearchResults([
    { id: 'resource:1', document_type: 'resource' },
    { id: 'claim:1', document_type: 'claim' },
    { id: 'entity:1', document_type: 'entity' },
    { id: 'claim:2', document_type: 'claim' }
  ])
  assert.deepEqual(groups.map(group => [group.type, group.results.length]), [
    ['entity', 1],
    ['claim', 2],
    ['resource', 1]
  ])
})

test('memory evidence presentation preserves provenance and opens only valid local message ids', () => {
  const evidence = normalizeMemoryEvidence({
    message_id: 'wechat:group-1:987654',
    session_id: 'group-1',
    timestamp: 1_700_000_000,
    sender: '发送者',
    excerpt: '原始消息',
    evidence_role: 'direct'
  })
  assert.deepEqual(evidence, {
    messageId: 'wechat:group-1:987654',
    sessionId: 'group-1',
    timestamp: 1_700_000_000,
    sender: '发送者',
    excerpt: '原始消息',
    role: 'direct'
  })
  assert.equal(evidenceLocalMessageId(evidence), 987654)
  assert.equal(evidenceLocalMessageId({ messageId: 'not-a-local-id' }), null)
  assert.equal(evidenceLocalMessageId({ messageId: '-1' }), null)
})
