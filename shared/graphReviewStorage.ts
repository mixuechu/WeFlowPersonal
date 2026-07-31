export const GRAPH_REVIEW_STORAGE_VERSION = 'pending-workset-v1'

export function compactGraphReviewWorkset(reviews: any[] | null | undefined): {
  pending: any[]
  resolved: any[]
  changed: boolean
} {
  const source = Array.isArray(reviews) ? reviews : []
  const pending: any[] = []
  const resolved: any[] = []
  for (const review of source) {
    if (review?.status === 'pending') pending.push(review)
    else resolved.push(review)
  }
  return { pending, resolved, changed: resolved.length > 0 }
}
