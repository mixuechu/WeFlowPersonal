import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceNavigationUnavailableReason,
  evidenceLocalMessageId,
  groupMemorySearchResults,
  memoryEvidenceSourceLabel,
  normalizeMemoryEvidence,
  wechatEvidenceNavigation
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
    session_name: '项目群',
    timestamp: 1_700_000_000,
    sender: '发送者',
    excerpt: '原始消息',
    evidence_role: 'direct'
  })
  assert.deepEqual(evidence, {
    sourceId: 'wechat',
    messageId: 'wechat:group-1:987654',
    sessionId: 'group-1',
    sessionName: '项目群',
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
  assert.deepEqual(wechatEvidenceNavigation(evidence), {
    sessionId: 'group-1',
    messageId: 987654
  })
  assert.equal(evidenceNavigationUnavailableReason(evidence), '')
  assert.equal(wechatEvidenceNavigation({
    sourceId: 'documents', sessionId: 'group-1', messageId: '12345'
  }), null)
  assert.equal(evidenceNavigationUnavailableReason({
    sourceId: 'documents', sessionId: 'group-1', messageId: '12345'
  }), '本机文档证据不支持微信原消息跳转')
  assert.equal(evidenceNavigationUnavailableReason({
    sourceId: 'wechat', messageId: '12345'
  }), '微信会话身份缺失，无法打开原消息')
  assert.equal(evidenceNavigationUnavailableReason({
    sourceId: 'wechat', sessionId: 'group-1', messageId: 'not-local'
  }), '微信消息身份不可用，无法打开原消息')
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
  assert.equal(memoryEvidenceSourceLabel(normalizeMemoryEvidence({
    message_id: 'opaque-message',
    session_id: 'old-session',
    evidenceKey: 'wechat:old-session:opaque-message'
  })), '微信')
})
