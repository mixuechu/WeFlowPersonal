export type ReviewStatusFilter = 'pending' | 'resolved' | 'all'

export function filterGraphReviews(
  reviews: any[],
  options: { status: ReviewStatusFilter; kind?: string; query?: string }
): any[] {
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
  return [...(reviews || [])]
    .filter(review =>
      (options.status === 'all' ||
        (options.status === 'pending' ? review.status === 'pending' : review.status !== 'pending')) &&
      (!options.kind || review.kind === options.kind) &&
      (!query || [
        review.title,
        review.detail,
        review.entityCanonicalName,
        review.summaryText,
        review.aliasText,
        review.resolutionReason,
        ...(review.evidence || []).flatMap((evidence: any) => [evidence.sender, evidence.excerpt])
      ].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query))))
    .sort((left, right) =>
      String(right.resolvedAt || right.createdAt || '').localeCompare(String(left.resolvedAt || left.createdAt || '')))
}
