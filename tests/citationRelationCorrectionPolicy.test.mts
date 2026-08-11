import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertCitationRelationCorrectionPreview,
  buildCitationRelationCorrectionPreview
} from '../electron/services/citationRelationCorrectionPolicy.ts'
import {
  normalizeRelationsAfterIdentityMerge,
  reconcileRelationReviewsAfterIdentityMerge
} from '../electron/services/relationCorrectionPolicy.ts'

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

test('all human relation correction entry points use SQLCipher evidence stats and moves', () => {
  const source = readFileSync(new URL(
    '../electron/services/aiAssistantService.ts', import.meta.url
  ), 'utf8')
  for (const [startMarker, endMarker] of [
    ['  previewRelationCorrectionFromMemoryDocument(', '\n  reviewMemoryDocument('],
    ['  previewRelationCorrection(', '\n  correctRelation(']
  ]) {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    const method = source.slice(start, end)
    assert.ok(start > 0 && end > start, startMarker)
    assert.match(method, /getRelationEvidenceMergeStats\(/)
    assert.doesNotMatch(method, /hydrateRelationEvidence\(/)
  }
  const reviewStart = source.indexOf('  private applyGraphReview(')
  const reviewEnd = source.indexOf('\n  previewRevertMerge(', reviewStart)
  const reviewMethod = source.slice(reviewStart, reviewEnd)
  assert.match(reviewMethod, /relationEvidenceMoves\.push\(/)
  assert.match(reviewMethod, /saveState\(true, \{ relationEvidenceMoves \}\)/)
  assert.equal((reviewMethod.match(/hydrateRelationEvidence\(/g) || []).length, 1,
    'identity merge remains the only full relation-evidence hydration in graph review')
})

test('identity merge relation normalization preserves confirmed authority regardless of order', () => {
  const candidate = {
    id: 'candidate-before-merge',
    subjectId: 'merged-person',
    predicate: '合作于',
    objectId: 'project',
    status: 'candidate',
    directionExplanation: '模型候选说明',
    confidence: 0.95,
    evidenceTotal: 40,
    evidence: [
      { sourceId: 'wechat', sessionId: 'group-a', messageId: 'same', excerpt: '候选原文一' },
      { sourceId: 'wechat', sessionId: 'group-b', messageId: 'same', excerpt: '候选原文二' }
    ],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }
  const confirmed = {
    id: 'confirmed-before-merge',
    subjectId: 'merged-person',
    predicate: '合作于',
    objectId: 'project',
    status: 'confirmed',
    directionExplanation: '人工确认方向说明',
    confidence: 0.8,
    evidenceTotal: 12,
    evidence: [
      { sourceId: 'mail', sessionId: 'inbox', messageId: 'same', excerpt: '确认原文' }
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z'
  }
  for (const relations of [[candidate, confirmed], [confirmed, candidate]]) {
    const normalized = normalizeRelationsAfterIdentityMerge(
      structuredClone(relations)
    )
    assert.equal(normalized.length, 1)
    assert.equal(normalized[0].status, 'confirmed')
    assert.equal(normalized[0].directionExplanation, '人工确认方向说明')
    assert.equal(normalized[0].confidence, 0.95)
    assert.equal(normalized[0].evidence.length, 3)
    assert.equal(normalized[0].evidenceTotal, 40)
    assert.equal(normalized[0].createdAt, '2026-08-01T00:00:00.000Z')
    assert.equal(normalized[0].updatedAt, '2026-08-05T00:00:00.000Z')
  }
})

test('identity merge closes or redirects relation reviews to the normalized graph', () => {
  const reviews = [
    { id: 'confirmed-review', kind: 'relation', relationId: 'old-confirmed', status: 'pending', detail: '确认候选' },
    { id: 'kept-review', kind: 'relation', relationId: 'old-candidate-a', status: 'pending', detail: '保留候选' },
    { id: 'duplicate-review', kind: 'relation', relationId: 'old-candidate-b', status: 'pending', detail: '重复候选' },
    { id: 'self-review', kind: 'relation', relationId: 'old-self', status: 'pending', detail: '自环候选' },
    { id: 'resolved-review', kind: 'relation', relationId: 'old-candidate-b', status: 'confirmed', detail: '历史决定' }
  ]
  reconcileRelationReviewsAfterIdentityMerge({
    reviewQueue: reviews,
    relationIdMap: new Map([
      ['old-confirmed', 'normalized-confirmed'],
      ['old-candidate-a', 'normalized-candidate'],
      ['old-candidate-b', 'normalized-candidate'],
      ['old-self', null]
    ]),
    relations: [
      { id: 'normalized-confirmed', status: 'confirmed' },
      { id: 'normalized-candidate', status: 'candidate' }
    ],
    resolvedAt: '2026-08-05T12:00:00.000Z'
  })
  assert.equal(reviews[0].status, 'rejected')
  assert.match(reviews[0].resolutionReason, /并入人工确认关系/)
  assert.equal(reviews[1].status, 'pending')
  assert.equal(reviews[1].relationId, 'normalized-candidate')
  assert.equal(reviews[2].status, 'rejected')
  assert.match(reviews[2].resolutionReason, /重复/)
  assert.equal(reviews[3].status, 'rejected')
  assert.match(reviews[3].resolutionReason, /自环/)
  assert.equal(reviews[4].status, 'confirmed')
  assert.equal(reviews[4].relationId, 'old-candidate-b')
})
