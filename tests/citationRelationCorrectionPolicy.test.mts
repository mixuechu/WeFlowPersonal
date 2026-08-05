import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCitationRelationCorrectionPreview,
  buildCitationRelationCorrectionPreview
} from '../electron/services/citationRelationCorrectionPolicy.ts'

const fixture = () => ({
  assistantMessageId: 'answer-1',
  documentId: 'relation:before',
  citationReviewToken: 'a'.repeat(64),
  entityDirectoryRevision: 'directory-1',
  sourceRelation: {
    id: 'before',
    subjectId: 'person',
    predicate: '服务对象',
    objectId: 'org',
    status: 'confirmed',
    evidence: [
      { sourceId: 'wechat', sessionId: 'one', messageId: 'same', excerpt: '原文一' },
      { sourceId: 'wechat', sessionId: 'two', messageId: 'same', excerpt: '原文二' }
    ]
  },
  targetRelation: {
    id: 'after',
    subjectId: 'org',
    predicate: '服务于',
    objectId: 'person',
    status: 'candidate',
    evidence: [
      { sourceId: 'wechat', sessionId: 'one', messageId: 'same', excerpt: '原文一' },
      { sourceId: 'mail', sessionId: 'inbox', messageId: 'same', excerpt: '邮件原文' }
    ]
  },
  plan: {
    before: { id: 'before', subjectId: 'person', predicate: '服务对象', objectId: 'org' },
    after: { id: 'after', subjectId: 'org', predicate: '服务于', objectId: 'person' },
    changed: true
  },
  reviewQueue: [
    { id: 'review-before', kind: 'relation', relationId: 'before', status: 'pending' },
    { id: 'review-after', kind: 'relation', relationId: 'after', status: 'pending' }
  ]
})

test('relation correction preview exposes exact merge, evidence and review impact', () => {
  const input = fixture()
  const preview = buildCitationRelationCorrectionPreview(input)
  assert.equal(preview.mergesExistingRelation, true)
  assert.equal(preview.sourceEvidenceCount, 2)
  assert.equal(preview.targetEvidenceCount, 2)
  assert.equal(preview.mergedEvidenceCount, 3)
  assert.equal(preview.duplicateEvidenceCount, 1)
  assert.equal(preview.affectedReviewCount, 2)
  assert.match(preview.previewToken, /^[a-f0-9]{64}$/)
  assert.doesNotThrow(() =>
    assertCitationRelationCorrectionPreview(preview, preview.previewToken))
})

test('relation correction preview token rejects target evidence and candidate drift', () => {
  const input = fixture()
  const original = buildCitationRelationCorrectionPreview(input)
  const changedEvidence = buildCitationRelationCorrectionPreview({
    ...input,
    targetRelation: {
      ...input.targetRelation,
      evidence: [
        ...input.targetRelation.evidence,
        { sourceId: 'wechat', sessionId: 'three', messageId: 'new', excerpt: '新增原文' }
      ]
    }
  })
  assert.throws(() =>
    assertCitationRelationCorrectionPreview(changedEvidence, original.previewToken),
  /重新核对/)
  const changedReviews = buildCitationRelationCorrectionPreview({
    ...input,
    reviewQueue: input.reviewQueue.slice(0, 1)
  })
  assert.throws(() =>
    assertCitationRelationCorrectionPreview(changedReviews, original.previewToken),
  /重新核对/)
})
