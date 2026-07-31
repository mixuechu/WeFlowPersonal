import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceLocalMessageId,
  groupMemorySearchResults,
  memoryEvidenceSourceLabel,
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
    sourceId: 'wechat',
    messageId: 'wechat:group-1:987654',
    sessionId: 'group-1',
    timestamp: 1_700_000_000,
    sender: '发送者',
    excerpt: '原始消息',
    role: 'direct'
  })
  assert.equal(evidenceLocalMessageId(evidence), 987654)
  assert.equal(evidenceLocalMessageId({ messageId: '12345' }), 12345)
  assert.equal(evidenceLocalMessageId({ messageId: 'document:report:12345' }), null)
  assert.equal(evidenceLocalMessageId({ messageId: 'calendar:event:12345' }), null)
  assert.equal(evidenceLocalMessageId({ messageId: 'not-a-local-id' }), null)
  assert.equal(evidenceLocalMessageId({ messageId: '-1' }), null)
  assert.equal(normalizeMemoryEvidence({ role: 'contradiction' }).role, 'contradiction')
  assert.equal(memoryEvidenceSourceLabel(evidence), '微信')
  assert.equal(memoryEvidenceSourceLabel(normalizeMemoryEvidence({
    message_id: 'opaque-message',
    session_id: 'data-source:calendar:work'
  })), 'macOS 日历')
  assert.equal(memoryEvidenceSourceLabel(normalizeMemoryEvidence({
    message_id: 'opaque-message',
    session_id: 'old-session'
  })), '历史来源未标注')
})
