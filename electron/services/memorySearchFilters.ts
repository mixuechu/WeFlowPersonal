export type MemorySearchOptions = {
  entityId?: string
  entitySelectionRevision?: string
  entityTerms?: string[]
  sessionId?: string
  sessionName?: string
  sessionSelectionToken?: string
  from?: string
  to?: string
  documentTypes?: string[]
  trustStatuses?: string[]
  supportability?: string
  evidenceConflict?: string
  evidenceStrength?: string
  evidenceBreadth?: string
  relationTypes?: string[]
  sourceIds?: string[]
}

export function isMemorySearchPageRevisionStale(input: {
  offset: number
  expectedRevision?: string
  startingRevision: string
  completedRevision: string
}): boolean {
  const expected = String(input.expectedRevision || '').trim()
  return input.startingRevision !== input.completedRevision ||
    (input.offset > 0 && expected !== input.startingRevision)
}

export function paginateMemoryResults(items: any[], offset = 0, limit = 40, cap = 500): {
  results: any[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
  truncated: boolean
} {
  const safeOffset = Math.max(0, Math.min(cap, Number(offset) || 0))
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40))
  const bounded = items.slice(0, cap)
  const results = bounded.slice(safeOffset, safeOffset + safeLimit)
  return {
    results,
    offset: safeOffset,
    limit: safeLimit,
    total: bounded.length,
    hasMore: safeOffset + results.length < bounded.length,
    truncated: items.length >= cap
  }
}

function isRejectedExtractedMemory(item: any): boolean {
  return ['claim', 'relation', 'event'].includes(String(item?.document_type || '')) &&
    String(item?.metadata?.status || '') === 'rejected'
}

function dateBoundary(value: string | undefined, endOfDay = false): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`
    : text
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

function itemTimestamps(item: any): number[] {
  const values: number[] = []
  for (const evidence of item.evidence || []) {
    const timestamp = Number(evidence.timestamp || 0)
    if (timestamp > 0) values.push(timestamp * 1000)
  }
  const metadata = item.metadata || {}
  // `updated_at` is the search-index maintenance time, not when the remembered
  // fact happened. Including it would make every document look recent after a
  // re-index or restore.
  for (const value of [metadata.startAt, metadata.endAt, metadata.validFrom, metadata.validTo, metadata.due]) {
    const timestamp = Date.parse(String(value || ''))
    if (Number.isFinite(timestamp)) values.push(timestamp)
  }
  return values
}

export function filterMemorySearchResults(
  items: any[],
  options: MemorySearchOptions = {},
  databaseScopeApplied = false
): any[] {
  const types = new Set((options.documentTypes || []).filter(Boolean))
  const trustStatuses = new Set((options.trustStatuses || []).filter(Boolean))
  const supportability = String(options.supportability || '')
  const evidenceConflict = String(options.evidenceConflict || '')
  const evidenceStrength = String(options.evidenceStrength || '')
  const evidenceBreadth = String(options.evidenceBreadth || '')
  const sources = new Set((options.sourceIds || []).map(value => value.trim().toLowerCase()).filter(Boolean))
  const relationTypes = new Set((options.relationTypes || []).map(value => value.trim().toLowerCase()).filter(Boolean))
  const entityTerms = (options.entityTerms || []).map(value => value.trim().toLowerCase()).filter(Boolean)
  const from = dateBoundary(options.from)
  const to = dateBoundary(options.to, true)
  return items.filter(item => {
    // Rejected extractions remain in the encrypted audit/history tables but
    // must not re-enter ordinary retrieval or downstream model context.
    if (isRejectedExtractedMemory(item)) return false
    if (types.size && !types.has(String(item.document_type || ''))) return false
    if (trustStatuses.size) {
      const trustStatus = ['claim', 'relation', 'event'].includes(String(item.document_type || ''))
        ? String(item.metadata?.status || 'candidate')
        : 'source'
      if (!trustStatuses.has(trustStatus)) return false
    }
    if (supportability) {
      const structured = ['claim', 'relation', 'event'].includes(String(item.document_type || ''))
      const canSupportFacts = item.document_type !== 'entity' &&
        (!structured || String(item.metadata?.status || '') === 'confirmed') &&
        (item.evidence || []).some((evidence: any) =>
          String(evidence.evidence_role || evidence.evidenceRole || '') !== 'contradiction')
      if (supportability === 'supporting' ? !canSupportFacts
        : supportability === 'review_only' ? canSupportFacts
          : true) return false
    }
    if (evidenceConflict) {
      const hasContradiction = (item.evidence || []).some((evidence: any) =>
        String(evidence.evidence_role || evidence.evidenceRole || '') === 'contradiction')
      if (evidenceConflict === 'with_contradiction' ? !hasContradiction
        : evidenceConflict === 'without_contradiction' ? hasContradiction
          : true) return false
    }
    if (evidenceStrength) {
      if (!['claim', 'relation', 'event'].includes(String(item.document_type || ''))) return false
      const roles = new Set((item.evidence || []).map((evidence: any) =>
        String(evidence.evidence_role || evidence.evidenceRole || 'direct')))
      const hasDirect = roles.has('direct')
      const hasIndirect = roles.has('indirect')
      if (evidenceStrength === 'direct' ? !hasDirect
        : evidenceStrength === 'indirect_only' ? (!hasIndirect || hasDirect)
          : true) return false
    }
    if (evidenceBreadth) {
      if (item.document_type === 'entity') return false
      const acceptedSessions = options.sessionId
        ? new Set([options.sessionId, options.sessionName].filter(Boolean))
        : null
      const supportingSources = new Set((item.evidence || [])
        .filter((evidence: any) =>
          String(evidence.evidence_role || evidence.evidenceRole || '') !== 'contradiction')
        .filter((evidence: any) => !sources.size || sources.has(
          String(evidence.source_id || evidence.sourceId || 'legacy').trim().toLowerCase()))
        .filter((evidence: any) => !acceptedSessions || acceptedSessions.has(
          String(evidence.session_id || evidence.sessionId || '')))
        .filter((evidence: any) => {
          if (from === null && to === null) return true
          const timestamp = Number(evidence.timestamp || 0) * 1000
          return timestamp > 0 && (from === null || timestamp >= from) &&
            (to === null || timestamp <= to)
        })
        .map((evidence: any) =>
          String(evidence.source_id || evidence.sourceId || 'legacy').trim().toLowerCase())
        .filter(Boolean))
      if (evidenceBreadth === 'multi_source' ? supportingSources.size < 2
        : evidenceBreadth === 'single_source' ? supportingSources.size !== 1
          : true) return false
    }
    if (relationTypes.size && item.document_type === 'relation') {
      const predicate = String(item.metadata?.predicate || item.title || '').trim().toLowerCase()
      if (![...relationTypes].some(type => predicate.includes(type) || type.includes(predicate))) return false
    }
    if (sources.size && !databaseScopeApplied) {
      if (!(item.evidence || []).some((evidence: any) =>
        sources.has(String(evidence.source_id || evidence.sourceId || 'legacy').trim().toLowerCase())
      )) return false
    }
    if (options.sessionId && !databaseScopeApplied) {
      const acceptedSessions = new Set([options.sessionId, options.sessionName].filter(Boolean))
      if (!(item.evidence || []).some((evidence: any) => acceptedSessions.has(String(evidence.session_id || evidence.sessionId || '')))) return false
    }
    if (options.entityId) {
      const metadata = item.metadata || {}
      const entityIds = [
        item.document_type === 'entity' ? item.source_id : '',
        metadata.subjectId,
        metadata.objectId,
        metadata.objectEntityId,
        ...(Array.isArray(metadata.participantIds) ? metadata.participantIds : [])
      ].map(String)
      const haystack = `${item.title || ''} ${item.search_text || ''}`.toLowerCase()
      if (!entityIds.includes(options.entityId) && !entityTerms.some(term => haystack.includes(term))) return false
    }
    if ((from !== null || to !== null) && !databaseScopeApplied) {
      const timestamps = itemTimestamps(item)
      if (!timestamps.some(timestamp => (from === null || timestamp >= from) && (to === null || timestamp <= to))) return false
    }
    return true
  })
}
