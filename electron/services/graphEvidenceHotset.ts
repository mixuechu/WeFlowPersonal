export const GRAPH_RELATION_EVIDENCE_HOT_LIMIT = 100

function relationEvidenceIdentity(item: any): string {
  return [
    String(item?.sourceId || ''),
    String(item?.sessionId || ''),
    String(item?.messageId || '')
  ].join('\0')
}

export function mergeRelationEvidenceHotset(
  relation: any,
  incoming: unknown,
  limit = GRAPH_RELATION_EVIDENCE_HOT_LIMIT
): any {
  const merged = new Map<string, any>()
  for (const item of [
    ...(Array.isArray(relation?.evidence) ? relation.evidence : []),
    ...(Array.isArray(incoming) ? incoming : [])
  ]) {
    if (!item?.messageId && !item?.excerpt) continue
    const key = relationEvidenceIdentity(item)
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, item)
      continue
    }
    merged.set(key, {
      ...previous,
      ...item,
      timestamp: Math.max(Number(previous?.timestamp || 0), Number(item?.timestamp || 0)),
      sender: String(item?.sender || previous?.sender || ''),
      excerpt: String(item?.excerpt || '').length >= String(previous?.excerpt || '').length
        ? item.excerpt
        : previous.excerpt
    })
  }
  relation.evidence = [...merged.values()]
  return compactRelationEvidenceHotset(relation, undefined, limit)
}

export function compactRelationEvidenceHotset(
  relation: any,
  authoritativeTotal?: number,
  limit = GRAPH_RELATION_EVIDENCE_HOT_LIMIT
): any {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || GRAPH_RELATION_EVIDENCE_HOT_LIMIT)))
  const rows = Array.isArray(relation?.evidence) ? relation.evidence : []
  const unique = new Map<string, any>()
  for (const item of rows) {
    const key = relationEvidenceIdentity(item)
    if (!item?.messageId && !item?.excerpt) continue
    const previous = unique.get(key)
    if (!previous || Number(item?.timestamp || 0) >= Number(previous?.timestamp || 0)) unique.set(key, item)
  }
  const sorted = [...unique.values()].sort((left, right) =>
    Number(left?.timestamp || 0) - Number(right?.timestamp || 0) ||
    String(left?.sourceId || '').localeCompare(String(right?.sourceId || '')) ||
    String(left?.sessionId || '').localeCompare(String(right?.sessionId || '')) ||
    String(left?.messageId || '').localeCompare(String(right?.messageId || '')))
  const knownTotal = Math.max(
    sorted.length,
    Number(relation?.evidenceTotal || 0),
    Number(authoritativeTotal || 0)
  )
  relation.evidence = sorted.slice(-safeLimit)
  relation.evidenceTotal = knownTotal
  return relation
}

export function compactGraphRelationEvidence(
  relations: any[],
  authoritativeTotals: Map<string, number> = new Map()
): void {
  for (const relation of relations || []) {
    compactRelationEvidenceHotset(relation, authoritativeTotals.get(String(relation?.id || '')))
  }
}
