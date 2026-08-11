export function isQuietTime(time: string, start: string, end: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start === end) return false
  return start < end ? time >= start && time < end : time >= start || time < end
}

export function buildWeeklyBriefing(
  briefings: Record<string, any>,
  tasks: any[],
  now = new Date(),
  taskSummary?: {
    activeTaskCount: number
    waitingTaskCount: number
    highPriorityTaskCount: number
  }
): any {
  const end = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now)
  const startDate = new Date(`${end}T00:00:00+08:00`)
  startDate.setDate(startDate.getDate() - 6)
  const start = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(startDate)
  const entries = Object.entries(briefings)
    .filter(([date]) => date >= start && date <= end)
    .sort(([left], [right]) => right.localeCompare(left))
  const highlights = [...new Set(entries.flatMap(([, briefing]) =>
    Array.isArray(briefing?.highlights) ? briefing.highlights.map(String) : []))].slice(0, 12)
  const activeTasks = taskSummary ? [] : tasks.filter(task => !['done', 'cancelled'].includes(task.status))
  const summaries = entries.map(([date, briefing]) => ({
    date,
    summary: String(briefing?.summary || ''),
    headline: String(briefing?.headline || ''),
    verified: briefing?.summaryVerified === true,
    evidence: Array.isArray(briefing?.summaryEvidence) ? briefing.summaryEvidence : [],
    evidenceTotal: Math.max(
      Number(briefing?.summaryEvidenceTotal || 0),
      Array.isArray(briefing?.summaryEvidence) ? briefing.summaryEvidence.length : 0
    ),
    evidenceTruncated: briefing?.summaryEvidenceTruncated === true
  }))
    .filter(item => item.summary || item.headline)
  return {
    start,
    end,
    daysWithUpdates: entries.length,
    messageCount: entries.reduce((sum, [, briefing]) => sum + Number(briefing?.messageCount || 0), 0),
    highlights,
    activeTaskCount: taskSummary?.activeTaskCount ?? activeTasks.length,
    waitingTaskCount: taskSummary?.waitingTaskCount ??
      activeTasks.filter(task => task.status === 'waiting' || task.taskKind === 'waiting').length,
    highPriorityTaskCount: taskSummary?.highPriorityTaskCount ??
      activeTasks.filter(task => task.priority === 'high').length,
    summaryCount: summaries.length,
    verifiedSummaryCount: summaries.filter(item => item.verified).length,
    summaryEvidenceCount: summaries.reduce((total, item) => total + item.evidenceTotal, 0),
    summaryEvidencePreviewCount: summaries.reduce((total, item) => total + item.evidence.length, 0),
    summaries
  }
}
