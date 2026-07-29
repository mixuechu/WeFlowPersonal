export type MemorySearchOptions = {
  entityId?: string
  entityTerms?: string[]
  sessionId?: string
  sessionName?: string
  from?: string
  to?: string
  documentTypes?: string[]
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

export function filterMemorySearchResults(items: any[], options: MemorySearchOptions = {}): any[] {
  const types = new Set((options.documentTypes || []).filter(Boolean))
  const entityTerms = (options.entityTerms || []).map(value => value.trim().toLowerCase()).filter(Boolean)
  const from = dateBoundary(options.from)
  const to = dateBoundary(options.to, true)
  return items.filter(item => {
    if (types.size && !types.has(String(item.document_type || ''))) return false
    if (options.sessionId) {
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
    if (from !== null || to !== null) {
      const timestamps = itemTimestamps(item)
      if (!timestamps.some(timestamp => (from === null || timestamp >= from) && (to === null || timestamp <= to))) return false
    }
    return true
  })
}
