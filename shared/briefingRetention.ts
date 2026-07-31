export const BRIEFING_RETENTION_DAYS = 90
export const BRIEFING_STORAGE_VERSION = 'briefing-retention-v1'

export function compactBriefings(
  input: Record<string, any> | null | undefined,
  limit = BRIEFING_RETENTION_DAYS
): {
  briefings: Record<string, any>
  changed: boolean
  removedDays: number
  strippedTaskSnapshots: number
  strippedTaskCount: number
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
  const retainedEntries = entries.slice(0, safeLimit).map(([date, briefing]) => {
    const value = briefing && typeof briefing === 'object' ? briefing : {}
    const { tasks: _tasks, ...compact } = value
    return [date, compact]
  })
  const removedDays = Math.max(0, entries.length - retainedEntries.length)
  return {
    briefings: Object.fromEntries(retainedEntries),
    changed: removedDays > 0 || strippedTaskSnapshots > 0,
    removedDays,
    strippedTaskSnapshots,
    strippedTaskCount,
    retainedDays: retainedEntries.length
  }
}
