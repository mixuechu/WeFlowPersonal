export type ReviewStatusFilter = 'pending' | 'resolved' | 'all'

export type GraphReviewPageOptions = {
  status: ReviewStatusFilter
  kind?: string
  query?: string
  reviewId?: string
  offset?: number
  limit?: number
  revision?: string
}

function reviewMatchesQuery(review: any, query: string): boolean {
  if (!query) return true
  return [
    review.title,
    review.detail,
    review.entityCanonicalName,
    review.summaryText,
    review.aliasText,
    review.resolutionReason,
    ...(review.evidence || []).flatMap((evidence: any) => [evidence.sender, evidence.excerpt])
  ].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query))
}

export function filterGraphReviews(
  reviews: any[],
  options: Pick<GraphReviewPageOptions, 'status' | 'kind' | 'query' | 'reviewId'>
): any[] {
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
  const reviewId = String(options.reviewId || '').trim()
  return [...(reviews || [])]
    .filter(review =>
      (options.status === 'all' ||
        (options.status === 'pending' ? review.status === 'pending' : review.status !== 'pending')) &&
      (!options.kind || review.kind === options.kind) &&
      (!reviewId || review.id === reviewId) &&
      reviewMatchesQuery(review, query))
    .sort((left, right) => {
      const timeOrder = String(right.resolvedAt || right.createdAt || '')
        .localeCompare(String(left.resolvedAt || left.createdAt || ''))
      return timeOrder || String(left.id || '').localeCompare(String(right.id || ''))
    })
}

export function paginateGraphReviews(reviews: any[], options: GraphReviewPageOptions): {
  items: any[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
  counts: { pending: number; resolved: number; all: number }
} {
  const offset = Math.max(0, Math.min(100_000, Math.floor(Number(options.offset) || 0)))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
  const reviewId = String(options.reviewId || '').trim()
  const matchingScope = (reviews || []).filter(review =>
    (!options.kind || review.kind === options.kind) &&
    (!reviewId || review.id === reviewId) &&
    reviewMatchesQuery(review, query))
  const counts = {
    pending: matchingScope.filter(review => review.status === 'pending').length,
    resolved: matchingScope.filter(review => review.status !== 'pending').length,
    all: matchingScope.length
  }
  const filtered = filterGraphReviews(matchingScope, options)
  return {
    items: filtered.slice(offset, offset + limit),
    offset,
    limit,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    counts
  }
}
