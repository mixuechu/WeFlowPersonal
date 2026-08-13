export const GRAPH_REVIEW_STORAGE_VERSION = 'pending-workset-v2'
export const GRAPH_REVIEW_STATE_EVIDENCE_LIMIT = 20

function reviewEvidenceIdentity(item: any): string {
  const sourceId = String(item?.sourceId || item?.source_id || 'legacy').trim() || 'legacy'
  const sessionId = String(item?.sessionId || item?.session_id || '').trim()
  const messageId = String(item?.messageId || item?.message_id || '').trim()
  if (messageId) return `${sourceId}\0${sessionId}\0${messageId}`
  return [
    sourceId,
    sessionId,
    Number(item?.timestamp || 0),
    String(item?.excerpt || '').trim()
  ].join('\0')
}

function compactPendingReview(review: any): { review: any; omitted: number; changed: boolean } {
  const evidence = Array.isArray(review?.evidence) ? review.evidence : []
  const unique = new Map<string, any>()
  for (const item of evidence) {
    if (!item || (!String(item.messageId || item.message_id || '').trim()
      && !String(item.excerpt || '').trim())) continue
    const key = reviewEvidenceIdentity(item)
    const previous = unique.get(key)
    if (!previous || Number(item.timestamp || 0) >= Number(previous.timestamp || 0)) {
      unique.set(key, item)
    }
  }
  const ordered = [...unique.values()].sort((left, right) =>
    Number(right?.timestamp || 0) - Number(left?.timestamp || 0)
    || reviewEvidenceIdentity(left).localeCompare(reviewEvidenceIdentity(right)))
  const retained = ordered.slice(0, GRAPH_REVIEW_STATE_EVIDENCE_LIMIT)
  const evidenceTotal = Math.max(
    ordered.length,
    Math.max(0, Number(review?.evidenceTotal || 0))
  )
  return {
    review: {
      ...review,
      evidence: retained,
      evidenceTotal
    },
    omitted: Math.max(0, evidenceTotal - retained.length),
    changed: evidence.length !== retained.length
      || Number(review?.evidenceTotal || 0) !== evidenceTotal
  }
}

export function compactGraphReviewWorkset(reviews: any[] | null | undefined): {
  pending: any[]
  resolved: any[]
  changed: boolean
  pendingEvidenceRows: number
  omittedPendingEvidenceRows: number
} {
  const source = Array.isArray(reviews) ? reviews : []
  const pending: any[] = []
  const resolved: any[] = []
  let pendingEvidenceRows = 0
  let omittedPendingEvidenceRows = 0
  let pendingChanged = false
  for (const review of source) {
    if (review?.status === 'pending') {
      const compacted = compactPendingReview(review)
      pending.push(compacted.review)
      pendingEvidenceRows += compacted.review.evidence.length
      omittedPendingEvidenceRows += compacted.omitted
      pendingChanged ||= compacted.changed
    } else resolved.push(review)
  }
  return {
    pending,
    resolved,
    changed: resolved.length > 0 || pendingChanged,
    pendingEvidenceRows,
    omittedPendingEvidenceRows
  }
}
