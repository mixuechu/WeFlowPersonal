export interface BriefingMemorySearchPlan {
  query: ''
  mode: 'hybrid'
  entityId: ''
  sessionId: ''
  sessionQuery: ''
  sourceId: ''
  documentType: ''
  trustStatus: ''
  supportability: ''
  evidenceConflict: ''
  evidenceStrength: ''
  evidenceBreadth: ''
  from: string
  to: string
}

/**
 * A briefing is only a bounded derivative. Opening its day must therefore
 * browse the complete authoritative day, without inheriting a hidden search
 * term or an unrelated scope from an earlier investigation.
 */
export function buildBriefingMemorySearchPlan(
  date: unknown
): BriefingMemorySearchPlan | null {
  const normalized = String(date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const [year, month, day] = normalized.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) return null
  return {
    query: '',
    mode: 'hybrid',
    entityId: '',
    sessionId: '',
    sessionQuery: '',
    sourceId: '',
    documentType: '',
    trustStatus: '',
    supportability: '',
    evidenceConflict: '',
    evidenceStrength: '',
    evidenceBreadth: '',
    from: normalized,
    to: normalized
  }
}
