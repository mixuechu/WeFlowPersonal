import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEntityCandidateEvidence } from '../electron/services/entityCandidateEvidencePolicy.ts'

test('entity candidate evidence preserves explicit source and the real sender fields', () => {
  assert.deepEqual(buildEntityCandidateEvidence([{
    sourceId: 'documents',
    sessionId: 'document-session',
    timestamp: 1_720_000_000,
    senderName: '产品文档',
    senderId: 'document-connector',
    content: ' 张三负责升级版交付。 '
  }], ['documents:document-session:message-1']), [{
    sourceId: 'documents',
    messageId: 'documents:document-session:message-1',
    sessionId: 'document-session',
    timestamp: 1_720_000_000,
    sender: '产品文档',
    excerpt: '张三负责升级版交付。'
  }])
})

test('entity candidate evidence labels owner messages and infers legacy source safely', () => {
  assert.deepEqual(buildEntityCandidateEvidence([{
    sessionId: 'group-a',
    timestamp: 1_720_000_001,
    direction: '我发送',
    senderName: '不应覆盖本人标签',
    content: '我来负责演示。'
  }], ['wechat:group-a:10001']), [{
    sourceId: 'wechat',
    messageId: 'wechat:group-a:10001',
    sessionId: 'group-a',
    timestamp: 1_720_000_001,
    sender: '我',
    excerpt: '我来负责演示。'
  }])
})

test('entity candidate evidence rejects rows without a bound key or reviewable excerpt', () => {
  assert.deepEqual(buildEntityCandidateEvidence([
    { sessionId: 'group-a', content: '' },
    { sessionId: 'group-b', content: '没有证据键' }
  ], ['wechat:group-a:10001']), [])
})
