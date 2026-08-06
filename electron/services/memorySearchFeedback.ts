import crypto from 'node:crypto'
import type { MemorySearchOptions } from './memorySearchFilters.ts'

export const MEMORY_SEARCH_FEEDBACK_VERSION = 'memory-search-feedback-v2'

export type MemorySearchFeedbackAction = 'helpful' | 'not_relevant' | 'cleared'

export type MemorySearchFeedbackContext = {
  query: string
  queryFingerprint: string
  scopeJson: string
  scopeFingerprint: string
}

function normalizedList(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean))].sort()
}

export function buildMemorySearchFeedbackContext(
  query: string,
  options: MemorySearchOptions = {}
): MemorySearchFeedbackContext {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 1000)
  const scope: Record<string, unknown> = {
    entityId: String(options.entityId || '').trim(),
    sessionId: String(options.sessionId || '').trim(),
    from: String(options.from || '').trim(),
    to: String(options.to || '').trim(),
    documentTypes: normalizedList(options.documentTypes),
    relationTypes: normalizedList(options.relationTypes),
    sourceIds: normalizedList(options.sourceIds)
  }
  const trustStatuses = normalizedList(options.trustStatuses)
  if (trustStatuses.length) scope.trustStatuses = trustStatuses
  const supportability = String(options.supportability || '').trim().toLowerCase()
  if (supportability) scope.supportability = supportability
  const evidenceConflict = String(options.evidenceConflict || '').trim().toLowerCase()
  if (evidenceConflict) scope.evidenceConflict = evidenceConflict
  const scopeJson = JSON.stringify(scope)
  return {
    query: normalizedQuery,
    queryFingerprint: crypto.createHash('sha256').update(normalizedQuery).digest('hex'),
    scopeJson,
    scopeFingerprint: crypto.createHash('sha256').update(scopeJson).digest('hex')
  }
}

export function applyMemorySearchFeedback(
  items: any[],
  decisions: Map<string, Exclude<MemorySearchFeedbackAction, 'cleared'>>
): any[] {
  return items.map((item, index) => {
    const feedback = decisions.get(String(item.id || '')) || ''
    const baseScore = Number.isFinite(Number(item.ranking_base_score))
      ? Number(item.ranking_base_score)
      : Number.isFinite(Number(item.hybrid_score))
        ? Number(item.hybrid_score)
        : 1 / (40 + index)
    const adjustment = feedback === 'helpful' ? 0.02 : feedback === 'not_relevant' ? -0.04 : 0
    return {
      ...item,
      ranking_base_score: baseScore,
      relevance_feedback: feedback,
      relevance_adjustment: adjustment,
      hybrid_score: baseScore + adjustment
    }
  }).sort((left, right) =>
    Number(right.hybrid_score || 0) - Number(left.hybrid_score || 0) ||
    String(left.id || '').localeCompare(String(right.id || ''))
  )
}
