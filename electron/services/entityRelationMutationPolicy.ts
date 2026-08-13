export function entityRelationMutationRevision(
  graphReviewRevision: unknown,
  structuredMemoryRevision: unknown
): string {
  return `${String(graphReviewRevision || '')}:${String(structuredMemoryRevision || '')}`
}

export function assertEntityRelationMutationRevision(
  expectedRevision: unknown,
  graphReviewRevision: unknown,
  structuredMemoryRevision: unknown
): string {
  const current = entityRelationMutationRevision(
    graphReviewRevision,
    structuredMemoryRevision
  )
  if (!String(expectedRevision || '').trim() || String(expectedRevision) !== current) {
    throw new Error('关系档案在展示后发生了变化，请刷新后重新操作')
  }
  return current
}
