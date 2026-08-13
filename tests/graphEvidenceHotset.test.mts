import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAPH_RELATION_EVIDENCE_HOT_LIMIT,
  compactGraphRelationEvidence,
  compactRelationEvidenceHotset,
  mergeRelationEvidenceHotset
} from '../electron/services/graphEvidenceHotset.ts'
import { boundedEvidencePayload } from '../shared/evidencePayload.ts'

test('relation evidence hotsets keep newest unique rows and preserve the authoritative total', () => {
  const relation = {
    id: 'relation',
    evidence: [
      ...Array.from({ length: 140 }, (_, index) => ({
        sourceId: 'wechat',
        sessionId: 'session',
        messageId: `message-${index}`,
        timestamp: index,
        excerpt: `原文 ${index}`
      })),
      {
        sourceId: 'wechat',
        sessionId: 'session',
        messageId: 'message-139',
        timestamp: 139,
        excerpt: '重复原文'
      }
    ]
  }
  compactRelationEvidenceHotset(relation)
  assert.equal(relation.evidence.length, GRAPH_RELATION_EVIDENCE_HOT_LIMIT)
  assert.equal(relation.evidenceTotal, 140)
  assert.equal(relation.evidence[0].messageId, 'message-40')
  assert.equal(relation.evidence.at(-1).messageId, 'message-139')
})

test('relation evidence merging preserves equal message ids from different carriers', () => {
  const relation = {
    id: 'relation',
    evidenceTotal: 1,
    evidence: [{
      sourceId: 'wechat',
      sessionId: 'group-a',
      messageId: 'shared-message',
      timestamp: 1,
      sender: '',
      excerpt: '微信原文'
    }]
  }
  mergeRelationEvidenceHotset(relation, [{
    sourceId: 'documents',
    sessionId: 'document-a',
    messageId: 'shared-message',
    timestamp: 2,
    sender: '本机文档',
    excerpt: '文档原文'
  }, {
    sourceId: 'wechat',
    sessionId: 'group-b',
    messageId: 'shared-message',
    timestamp: 3,
    sender: '群成员',
    excerpt: '另一个群的原文'
  }])
  assert.equal(relation.evidence.length, 3)
  assert.deepEqual(relation.evidence.map((item: any) => [
    item.sourceId, item.sessionId, item.messageId
  ]), [
    ['wechat', 'group-a', 'shared-message'],
    ['documents', 'document-a', 'shared-message'],
    ['wechat', 'group-b', 'shared-message']
  ])
})

test('relation evidence merging enriches an exact carrier without duplicating it', () => {
  const relation = {
    id: 'relation',
    evidence: [{
      sourceId: 'wechat',
      sessionId: 'group-a',
      messageId: 'message-a',
      timestamp: 1,
      sender: '',
      excerpt: '短'
    }]
  }
  mergeRelationEvidenceHotset(relation, [{
    sourceId: 'wechat',
    sessionId: 'group-a',
    messageId: 'message-a',
    timestamp: 2,
    sender: '张三',
    excerpt: '更完整的原文'
  }])
  assert.equal(relation.evidence.length, 1)
  assert.equal(relation.evidence[0].timestamp, 2)
  assert.equal(relation.evidence[0].sender, '张三')
  assert.equal(relation.evidence[0].excerpt, '更完整的原文')
})

test('authoritative relation totals survive graph compaction and bounded rendering', () => {
  const relation = {
    id: 'relation',
    evidence: Array.from({ length: 130 }, (_, index) => ({
      messageId: `message-${index}`,
      timestamp: index,
      excerpt: `原文 ${index}`
    }))
  }
  compactGraphRelationEvidence([relation], new Map([['relation', 9_000]]))
  assert.equal(relation.evidence.length, GRAPH_RELATION_EVIDENCE_HOT_LIMIT)
  assert.equal(relation.evidenceTotal, 9_000)
  const payload = boundedEvidencePayload(relation.evidence, 8, relation.evidenceTotal)
  assert.equal(payload.evidence.length, 8)
  assert.equal(payload.evidenceTotal, 9_000)
})
