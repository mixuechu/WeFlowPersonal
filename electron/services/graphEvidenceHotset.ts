export const GRAPH_RELATION_EVIDENCE_HOT_LIMIT = 100

export function compactRelationEvidenceHotset(
  relation: any,
  authoritativeTotal?: number,
  limit = GRAPH_RELATION_EVIDENCE_HOT_LIMIT
): any {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || GRAPH_RELATION_EVIDENCE_HOT_LIMIT)))
  const rows = Array.isArray(relation?.evidence) ? relation.evidence : []
  const unique = new Map<string, any>()
  for (const item of rows) {
    const key = [
      String(item?.sourceId || ''),
      String(item?.sessionId || ''),
      String(item?.messageId || '')
    ].join('\0')
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
