export type BlockedRelationReturnTarget = {
  kind: 'relation_review'
  reviewId: string
  title: string
  entityIds: string[]
}

export type BlockedStructuredMemoryReturnTarget = {
  kind: 'structured_memory'
  memoryKind: 'claim' | 'event'
  sourceId: string
  title: string
  entityIds: string[]
}

export type BlockedIdentityReturnTarget =
  | BlockedRelationReturnTarget
  | BlockedStructuredMemoryReturnTarget

export function blockedEntityMissingGuidance(
  memoryKind: 'claim' | 'event' | 'relation'
): string {
  if (memoryKind === 'claim') {
    return '该身份已不在图谱中；请点击本卡片“纠正”，重新选择事实主体或对象，也可把对象改为普通值。'
  }
  if (memoryKind === 'event') {
    return '该身份已不在图谱中；请点击本卡片“纠正”，重新选择或移除对应参与者。'
  }
  return '该身份已不在图谱中；请直接在上方主语或宾语选择器中改选已确认实体。'
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

export function buildBlockedStructuredMemoryReturnTarget(
  memoryKind: 'claim' | 'event',
  item: {
    id?: string
    title?: string
    subject_name?: string
    predicate?: string
    untrusted_entity_review_targets?: Array<{ id?: string; trustStatus?: string }>
  } | null | undefined
): BlockedStructuredMemoryReturnTarget | null {
  const sourceId = String(item?.id || '').trim()
  if (!sourceId) return null
  const title = memoryKind === 'claim'
    ? `${String(item?.subject_name || '未知主体').trim() || '未知主体'} · ${String(item?.predicate || '事实').trim() || '事实'}`
    : String(item?.title || '事件').trim() || '事件'
  return {
    kind: 'structured_memory',
    memoryKind,
    sourceId,
    title,
    entityIds: blockedEntityReviewScope(item).entityIds
  }
}

export function shouldReturnToBlockedIdentitySource(
  target: BlockedIdentityReturnTarget | null,
  completedReview: { id?: string; kind?: string; entityId?: string } | null | undefined
): boolean {
  if (!target || !completedReview || completedReview.kind !== 'entity_creation') return false
  const reviewId = String(completedReview.id || '').trim()
  const entityId = String(completedReview.entityId || '').trim()
  const isOriginalRelationReview = target.kind === 'relation_review' &&
    reviewId === target.reviewId
  return Boolean(reviewId && !isOriginalRelationReview && entityId &&
    target.entityIds.includes(entityId))
}
