import { parseShanghaiDateBoundary } from '../../shared/shanghaiDateBoundary.ts'

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
  if (parseShanghaiDateBoundary(normalized).state !== 'valid') return null
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
