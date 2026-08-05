export function applyCitationRelationDecision(
  graph: any,
  relationId: string,
  decision: 'confirmed' | 'rejected',
  now: string
): any | null {
  const relation = (graph?.relations || []).find((item: any) => item.id === relationId)
  if (!relation) return null
  relation.status = decision
  relation.updatedAt = now
  for (const review of graph?.reviewQueue || []) {
    if (review.kind !== 'relation' || review.relationId !== relationId || review.status !== 'pending') {
      continue
    }
    review.status = decision
    review.resolvedAt = now
    review.resolutionActor = 'user'
    review.resolutionReason = decision === 'confirmed'
      ? '用户在统一记忆中确认关系'
      : '用户在统一记忆中拒绝关系'
  }
  return relation
}

export function resolveCitationRelationCorrectionReviews(
  graph: any,
  beforeRelationId: string,
  afterRelationId: string,
  now: string
): void {
  for (const review of graph?.reviewQueue || []) {
    if (
      review.kind !== 'relation'
      || review.status !== 'pending'
      || ![beforeRelationId, afterRelationId].includes(String(review.relationId || ''))
    ) continue
    const matchesSource = String(review.relationId || '') === beforeRelationId
    review.status = matchesSource ? 'confirmed' : 'rejected'
    review.originalRelationId = beforeRelationId
    review.correctedRelationId = afterRelationId
    review.relationId = afterRelationId
    review.resolvedAt = now
    review.resolutionActor = matchesSource ? 'user' : 'system'
    review.resolutionReason = matchesSource
      ? '用户在回答引用中纠正并确认关系'
      : '关系已由回答引用中的人工纠正合并'
  }
}

export function applyCitationRelationCorrection(
  graph: any,
  sourceRelationId: string,
  plan: RelationConfirmationPlan,
  now: string
): any {
  const applied = applyRelationConfirmation({
    relations: graph?.relations || [],
    sourceRelationId,
    plan,
    now
  })
  graph.relations = applied.relations
  resolveCitationRelationCorrectionReviews(
    graph,
    plan.before.id,
    plan.after.id,
    now
  )
  return applied.confirmedRelation
}
import {
  applyRelationConfirmation,
  type planRelationConfirmation
} from './relationCorrectionPolicy.ts'

type RelationConfirmationPlan = ReturnType<typeof planRelationConfirmation>
