export const BRIEFING_RETENTION_DAYS = 90
export const BRIEFING_SUMMARY_EVIDENCE_LIMIT = 40
export const BRIEFING_STORAGE_VERSION = 'briefing-retention-v2'

function briefingEvidenceIdentity(value: any): string {
  const explicit = String(value?.evidenceKey || '').trim()
  if (explicit) return explicit
  const sourceId = String(value?.sourceId || '').trim()
  const sessionId = String(value?.sessionId || '').trim()
  const messageId = String(value?.messageId || '').trim()
  return sourceId && sessionId && messageId ? `${sourceId}:${sessionId}:${messageId}` : ''
}

export function compactBriefings(
  input: Record<string, any> | null | undefined,
  limit = BRIEFING_RETENTION_DAYS
): {
  briefings: Record<string, any>
  changed: boolean
  removedDays: number
  strippedTaskSnapshots: number
  strippedTaskCount: number
  summaryEvidenceRows: number
  summaryEvidenceRowsOmitted: number
  summaryEvidenceRowsDeduplicated: number
  summaryEvidenceDaysCompacted: number
  retainedDays: number
} {
  const safeLimit = Math.max(7, Math.min(365, Math.floor(Number(limit) || BRIEFING_RETENTION_DAYS)))
  const source = input && typeof input === 'object' ? input : {}
  const entries = Object.entries(source).sort(([left], [right]) => right.localeCompare(left))
  const strippedTaskSnapshots = entries.filter(([, briefing]) =>
    briefing && typeof briefing === 'object' &&
    Object.prototype.hasOwnProperty.call(briefing, 'tasks')).length
  const strippedTaskCount = entries.reduce((total, [, briefing]) =>
    total + (Array.isArray((briefing as any)?.tasks) ? (briefing as any).tasks.length : 0), 0)
  let summaryEvidenceRows = 0
  let summaryEvidenceRowsOmitted = 0
  let summaryEvidenceRowsDeduplicated = 0
  let summaryEvidenceDaysCompacted = 0
  let evidenceChanged = false
  const retainedEntries = entries.slice(0, safeLimit).map(([date, briefing]) => {
    const value = briefing && typeof briefing === 'object' ? briefing : {}
    const { tasks: _tasks, ...compact } = value
    const rawEvidence = Array.isArray(value.summaryEvidence)
      ? value.summaryEvidence.filter((item: any) => item && typeof item === 'object')
      : []
    const uniqueEvidence = [...new Map(rawEvidence.flatMap((item: any) => {
      const identity = briefingEvidenceIdentity(item)
      return identity ? [[identity, item] as const] : []
    })).values()]
    const retainedEvidence = uniqueEvidence.slice(0, BRIEFING_SUMMARY_EVIDENCE_LIMIT)
    const previousTotalValue = Number(value.summaryEvidenceTotal)
    const previousTotal = Number.isFinite(previousTotalValue)
      ? Math.max(0, Math.min(1_000_000, Math.floor(previousTotalValue)))
      : 0
    const total = Math.max(previousTotal, uniqueEvidence.length)
    const omitted = Math.max(0, total - retainedEvidence.length)
    const deduplicated = Math.max(0, rawEvidence.length - uniqueEvidence.length)
    const normalized = {
      ...compact,
      summaryEvidence: retainedEvidence,
      summaryEvidenceTotal: total,
      summaryEvidenceTruncated: omitted > 0
    }
    summaryEvidenceRows += retainedEvidence.length
    summaryEvidenceRowsOmitted += omitted
    summaryEvidenceRowsDeduplicated += deduplicated
    if (omitted > 0 || deduplicated > 0) summaryEvidenceDaysCompacted += 1
    if (JSON.stringify(normalized) !== JSON.stringify(compact)) evidenceChanged = true
    return [date, normalized]
  })
  const removedDays = Math.max(0, entries.length - retainedEntries.length)
  return {
    briefings: Object.fromEntries(retainedEntries),
    changed: removedDays > 0 || strippedTaskSnapshots > 0 || evidenceChanged,
    removedDays,
    strippedTaskSnapshots,
    strippedTaskCount,
    summaryEvidenceRows,
    summaryEvidenceRowsOmitted,
    summaryEvidenceRowsDeduplicated,
    summaryEvidenceDaysCompacted,
    retainedDays: retainedEntries.length
  }
}
