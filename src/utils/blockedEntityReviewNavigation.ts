export type BlockedRelationReturnTarget = {
  reviewId: string
  title: string
  entityIds: string[]
}

export function shouldReturnToBlockedRelationReview(
  target: BlockedRelationReturnTarget | null,
  completedReview: { id?: string; kind?: string; entityId?: string } | null | undefined
): boolean {
  if (!target || !completedReview || completedReview.kind !== 'entity_creation') return false
  const reviewId = String(completedReview.id || '').trim()
  const entityId = String(completedReview.entityId || '').trim()
  return Boolean(reviewId && reviewId !== target.reviewId && entityId &&
    target.entityIds.includes(entityId))
}
