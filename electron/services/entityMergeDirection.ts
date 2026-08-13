export type MergeEntity = {
  id: string
  canonicalName?: string
  type?: string
}

export type DuplicateReview = {
  leftEntityId?: string
  rightEntityId?: string
}

export function planEntityMerge(
  review: DuplicateReview,
  entities: MergeEntity[],
  requestedTargetId?: string
): { source: MergeEntity; target: MergeEntity } {
  const leftId = String(review.leftEntityId || '')
  const rightId = String(review.rightEntityId || '')
  if (!leftId || !rightId || leftId === rightId) throw new Error('身份合并候选信息不完整')
  if (!requestedTargetId) throw new Error('请选择合并后要保留的身份')
  if (requestedTargetId !== leftId && requestedTargetId !== rightId) {
    throw new Error('保留身份不属于当前合并候选')
  }
  const sourceId = requestedTargetId === leftId ? rightId : leftId
  const source = entities.find(entity => entity.id === sourceId)
  const target = entities.find(entity => entity.id === requestedTargetId)
  if (!source || !target) throw new Error('合并候选中的身份已不存在，请刷新后重试')
  if (source.type && target.type && source.type !== target.type) {
    throw new Error('不同类型的实体不能直接合并')
  }
  return { source, target }
}
