export const MEMORY_CARD_EVIDENCE_LIMIT = 20
export const GRAPH_QUERY_EVIDENCE_LIMIT = 8
export const PROJECT_EVIDENCE_LIMIT = 50

export type BoundedEvidencePayload = {
  evidence: any[]
  evidenceTotal: number
}

export function evidenceArchiveIdentity(item: any): string {
  return [
    String(item?.sourceId ?? item?.source_id ?? ''),
    String(item?.sessionId ?? item?.session_id ?? ''),
    String(item?.messageId ?? item?.message_id ?? '')
  ].join('\u0000')
}

export function boundedEvidencePayload(
  evidence: unknown,
  limit: number,
  authoritativeTotal?: number
): BoundedEvidencePayload {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 1)))
  const rows = Array.isArray(evidence) ? evidence : []
  const normalized = rows.map(item => ({
    sourceId: String(item?.sourceId || item?.source_id || ''),
    messageId: String(item?.messageId || item?.message_id || ''),
    sessionId: String(item?.sessionId || item?.session_id || ''),
    timestamp: Number(item?.timestamp || 0),
    sender: String(item?.sender || ''),
    excerpt: String(item?.excerpt || '').slice(0, 1000),
    role: String(item?.role || item?.evidence_role || item?.evidenceRole || '')
  })).filter(item => item.messageId || item.excerpt)
  normalized.sort((left, right) =>
    right.timestamp - left.timestamp ||
    right.sourceId.localeCompare(left.sourceId) ||
    right.sessionId.localeCompare(left.sessionId) ||
    right.messageId.localeCompare(left.messageId))
  return {
    evidence: normalized.slice(0, safeLimit).reverse(),
    evidenceTotal: Math.max(normalized.length, Math.max(0, Number(authoritativeTotal || 0)))
  }
}
