import { createHash } from 'node:crypto'

const evidenceKey = (item: any): string => [
  String(item?.sourceId || item?.source_id || ''),
  String(item?.sessionId || item?.session_id || ''),
  String(item?.messageId || item?.message_id || ''),
  String(item?.timestamp || ''),
  String(item?.sender || ''),
  createHash('sha256').update(String(item?.excerpt || '')).digest('hex')
].join('\u001f')

const relationIdentity = (relation: any): any => relation ? {
  id: String(relation.id || ''),
  subjectId: String(relation.subjectId || ''),
  predicate: String(relation.predicate || ''),
  objectId: String(relation.objectId || ''),
  status: String(relation.status || ''),
  evidence: [...new Set((relation.evidence || []).map(evidenceKey))].sort()
} : null

export function buildCitationRelationCorrectionPreview(input: {
  assistantMessageId: string
  documentId: string
  citationReviewToken: string
  entityDirectoryRevision: string
  sourceRelation: any
  targetRelation?: any | null
  plan: any
  reviewQueue?: any[]
  evidenceStats?: {
    sourceCount: number
    targetCount: number
    mergedCount: number
    duplicateCount: number
    identity: string
  }
}): any {
  const sourceEvidence = new Set((input.sourceRelation?.evidence || []).map(evidenceKey))
  const targetEvidence = new Set((input.targetRelation?.evidence || []).map(evidenceKey))
  const mergedEvidence = new Set([...targetEvidence, ...sourceEvidence])
  const stats = input.evidenceStats || {
    sourceCount: sourceEvidence.size,
    targetCount: targetEvidence.size,
    mergedCount: mergedEvidence.size,
    duplicateCount: sourceEvidence.size + targetEvidence.size - mergedEvidence.size,
    identity: [...mergedEvidence].sort().join('\u001e')
  }
  const affectedReviewIds = (input.reviewQueue || []).filter(review =>
    review?.kind === 'relation'
    && review?.status === 'pending'
    && [input.plan.before.id, input.plan.after.id].includes(String(review.relationId || ''))
  ).map(review => String(review.id || '')).filter(Boolean).sort()
  const identity = {
    assistantMessageId: String(input.assistantMessageId || ''),
    documentId: String(input.documentId || ''),
    citationReviewToken: String(input.citationReviewToken || ''),
    entityDirectoryRevision: String(input.entityDirectoryRevision || ''),
    sourceRelation: relationIdentity(input.sourceRelation),
    targetRelation: relationIdentity(input.targetRelation),
    before: input.plan.before,
    after: input.plan.after,
    evidenceIdentity: stats.identity,
    affectedReviewIds
  }
  return {
    before: input.plan.before,
    after: input.plan.after,
    changed: Boolean(input.plan.changed),
    mergesExistingRelation: Boolean(input.targetRelation),
    sourceEvidenceCount: stats.sourceCount,
    targetEvidenceCount: stats.targetCount,
    mergedEvidenceCount: stats.mergedCount,
    duplicateEvidenceCount: stats.duplicateCount,
    affectedReviewCount: affectedReviewIds.length,
    previewToken: createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  }
}

export function assertCitationRelationCorrectionPreview(
  currentPreview: any,
  token: unknown
): void {
  const expected = String(currentPreview?.previewToken || '')
  const provided = String(token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided) || provided !== expected) {
    throw new Error('关系、原文、实体目录或候选影响范围在预览后已经变化，请重新核对')
  }
}
