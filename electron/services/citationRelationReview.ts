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
