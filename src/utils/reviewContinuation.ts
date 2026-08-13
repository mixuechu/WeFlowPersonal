export type ReviewContinuationPlan = {
  completedId: string
  preferredId: string
  remaining: number
}

export function planReviewContinuation(
  items: Array<{ id?: unknown; status?: unknown }>,
  completedId: unknown,
  totalBefore: unknown
): ReviewContinuationPlan | null {
  const id = String(completedId || '').trim()
  if (!id) return null
  const pending = items
    .map(item => ({
      id: String(item?.id || '').trim(),
      status: String(item?.status || '')
    }))
    .filter(item => item.id && item.status === 'pending')
  const index = pending.findIndex(item => item.id === id)
  const preferred = index < 0
    ? pending.find(item => item.id !== id)
    : pending.slice(index + 1).find(item => item.id !== id) ||
      pending.slice(0, index).find(item => item.id !== id)
  return {
    completedId: id,
    preferredId: preferred?.id || '',
    remaining: Math.max(0, Number(totalBefore || 0) - 1)
  }
}

export function resolveReviewContinuation(
  plan: ReviewContinuationPlan | null,
  refreshedItems: Array<{ id?: unknown; status?: unknown }>
): string {
  if (!plan) return ''
  const pendingIds = refreshedItems
    .filter(item => String(item?.status || '') === 'pending')
    .map(item => String(item?.id || '').trim())
    .filter(Boolean)
  return pendingIds.includes(plan.preferredId)
    ? plan.preferredId
    : pendingIds[0] || ''
}
