import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAPH_RELATION_EVIDENCE_HOT_LIMIT,
  compactGraphRelationEvidence,
  compactRelationEvidenceHotset
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
