type FeedbackScope = {
  entityId?: unknown
  sessionId?: unknown
  from?: unknown
  to?: unknown
  documentTypes?: unknown
  relationTypes?: unknown
  sourceIds?: unknown
}

function normalizedList(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean))].sort()
}

export function memoryFeedbackOperationKey(
  documentId: unknown,
  query: unknown,
  options: FeedbackScope = {}
): string {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 1000)
  const scope = {
    entityId: String(options.entityId || '').trim(),
    sessionId: String(options.sessionId || '').trim(),
    from: String(options.from || '').trim(),
    to: String(options.to || '').trim(),
    documentTypes: normalizedList(options.documentTypes),
    relationTypes: normalizedList(options.relationTypes),
    sourceIds: normalizedList(options.sourceIds)
  }
  return `${String(documentId || '').trim()}\u0000${normalizedQuery}\u0000${JSON.stringify(scope)}`
}

export function setKeyedActionState<T extends string>(
  current: Record<string, T>,
  key: string,
  action?: T
): Record<string, T> {
  if (action) return current[key] === action ? current : { ...current, [key]: action }
  if (!current[key]) return current
  const next = { ...current }
  delete next[key]
  return next
}
