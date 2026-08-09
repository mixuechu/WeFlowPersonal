export type BlockedRelationReturnTarget = {
  reviewId: string
  title: string
  entityIds: string[]
}

export function blockedEntityReviewScope(item: {
  untrusted_entity_review_targets?: Array<{ id?: string; trustStatus?: string }>
} | null | undefined): { status: 'pending' | 'all'; entityIds: string[] } {
  const targets = Array.isArray(item?.untrusted_entity_review_targets)
    ? item.untrusted_entity_review_targets : []
  const entityIds = [...new Set(targets
    .map(target => String(target?.id || '').trim())
    .filter(Boolean))]
  return {
    status: targets.some(target => target?.trustStatus !== 'candidate') ? 'all' : 'pending',
    entityIds
  }
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
