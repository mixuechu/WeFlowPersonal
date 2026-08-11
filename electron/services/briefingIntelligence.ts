export function isQuietTime(time: string, start: string, end: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start === end) return false
  return start < end ? time >= start && time < end : time >= start || time < end
}

function briefingEvidenceIdentity(value: any): string {
  const explicit = String(value?.evidenceKey || '').trim()
  if (explicit) return explicit
  const sourceId = String(value?.sourceId || '').trim()
  const sessionId = String(value?.sessionId || '').trim()
  const messageId = String(value?.messageId || '').trim()
  return sourceId && sessionId && messageId ? `${sourceId}:${sessionId}:${messageId}` : ''
}

function boundedCount(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number)))
    : 0
}

export function mergeDailyBriefing(existing: any, incoming: any): any {
  const current = existing && typeof existing === 'object' ? existing : null
  const incrementId = String(incoming?.incrementId || '').trim()
  const recentIncrementIds = Array.isArray(current?.recentIncrementIds)
    ? current.recentIncrementIds.map(String).filter(Boolean).slice(-31)
    : []
  if (incrementId && recentIncrementIds.includes(incrementId)) return current
  const messageCount = Math.min(
    Number.MAX_SAFE_INTEGER,
    boundedCount(current?.messageCount) + boundedCount(incoming?.messageCount)
  )
  const incomingSummary = String(incoming?.summary || '').replace(/\s+/g, ' ').trim()
  const existingSummary = String(current?.summary || '').replace(/\s+/g, ' ').trim()
  const summary = [incomingSummary, existingSummary].filter(Boolean).join(' ').slice(0, 900)
  const rawEvidence = [
    ...(Array.isArray(incoming?.summaryEvidence) ? incoming.summaryEvidence : []),
    ...(Array.isArray(current?.summaryEvidence) ? current.summaryEvidence : [])
  ]
  const summaryEvidenceByIdentity = new Map<string, any>()
  for (const item of rawEvidence) {
    const identity = briefingEvidenceIdentity(item)
    if (identity && !summaryEvidenceByIdentity.has(identity)) {
      summaryEvidenceByIdentity.set(identity, item)
    }
  }
  const summaryEvidence = [...summaryEvidenceByIdentity.values()]
  const retainedCurrentEvidence = new Set((Array.isArray(current?.summaryEvidence)
    ? current.summaryEvidence : []).map(briefingEvidenceIdentity).filter(Boolean))
  const newEvidenceCount = new Set((Array.isArray(incoming?.summaryEvidence)
    ? incoming.summaryEvidence : []).map(briefingEvidenceIdentity).filter(Boolean))
  for (const identity of retainedCurrentEvidence) newEvidenceCount.delete(identity)
  const summaryEvidenceTotal = Math.min(
    1_000_000,
    Math.max(boundedCount(current?.summaryEvidenceTotal), retainedCurrentEvidence.size) +
      newEvidenceCount.size
  )
  const rawHighlights = [
    ...(Array.isArray(incoming?.highlightItems) ? incoming.highlightItems : []),
    ...(Array.isArray(current?.highlightItems) ? current.highlightItems : [])
  ]
  const highlightsByText = new Map<string, any>()
  for (const item of rawHighlights) {
    const text = String(item?.text || '').trim()
    if (text && !highlightsByText.has(text)) highlightsByText.set(text, item)
  }
  const highlightItems = [...highlightsByText.values()].slice(0, 8)
  const rejectedSummaryCount = boundedCount(current?.evidencePolicy?.rejectedSummaryCount) +
    boundedCount(incoming?.evidencePolicy?.rejectedSummaryCount)
  const rejectedHighlightCount = boundedCount(current?.evidencePolicy?.rejectedHighlightCount) +
    boundedCount(incoming?.evidencePolicy?.rejectedHighlightCount)
  const currentIncrementCount = current
    ? Math.max(1, boundedCount(current?.incrementCount))
    : 0
  const currentFailedSessionsTotal = Math.max(
    boundedCount(current?.failedSessionsTotal),
    boundedCount(current?.failedSessions)
  )
  return {
    ...current,
    ...incoming,
    version: 'daily-briefing-v2',
    headline: `今日已整理 ${messageCount} 条新增消息`,
    summary,
    summaryEvidence,
    summaryEvidenceTotal,
    summaryEvidenceTruncated: summaryEvidenceTotal > summaryEvidence.length,
    summaryVerified: Boolean(summary && summaryEvidenceTotal > 0),
    highlightItems,
    highlights: highlightItems.map((item: any) => String(item.text || '')).filter(Boolean),
    evidencePolicy: {
      version: 'briefing-evidence-v1',
      rejectedSummaryCount: Math.min(Number.MAX_SAFE_INTEGER, rejectedSummaryCount),
      rejectedHighlightCount: Math.min(Number.MAX_SAFE_INTEGER, rejectedHighlightCount)
    },
    messageCount,
    lastIncrementMessageCount: boundedCount(incoming?.messageCount),
    incrementCount: Math.min(Number.MAX_SAFE_INTEGER, currentIncrementCount + 1),
    failedSessions: boundedCount(incoming?.failedSessions),
    failedSessionsTotal: Math.min(
      Number.MAX_SAFE_INTEGER,
      currentFailedSessionsTotal + boundedCount(incoming?.failedSessions)
    ),
    firstGeneratedAt: String(current?.firstGeneratedAt || current?.generatedAt ||
      incoming?.generatedAt || ''),
    generatedAt: String(incoming?.generatedAt || current?.generatedAt || ''),
    recentIncrementIds: incrementId
      ? [...recentIncrementIds, incrementId].slice(-32)
      : recentIncrementIds
  }
}

function briefingArchiveRevision(entries: Array<[string, any]>): string {
  const hash = createHash('sha256')
  for (const [date, briefing] of entries) {
    hash.update(JSON.stringify({
      date,
      generatedAt: String(briefing?.generatedAt || ''),
      messageCount: boundedCount(briefing?.messageCount),
      incrementCount: boundedCount(briefing?.incrementCount),
      summary: String(briefing?.summary || '').slice(0, 900),
      summaryVerified: briefing?.summaryVerified === true,
      summaryEvidenceTotal: boundedCount(briefing?.summaryEvidenceTotal),
      summaryEvidence: (Array.isArray(briefing?.summaryEvidence)
        ? briefing.summaryEvidence : []).slice(0, 40).map((evidence: any) => ({
        evidenceKey: String(evidence?.evidenceKey || '').slice(0, 1_100),
        timestamp: Number.isFinite(Number(evidence?.timestamp)) ? Number(evidence.timestamp) : 0,
        sender: String(evidence?.sender || '').slice(0, 200),
        excerpt: String(evidence?.excerpt || '').slice(0, 500)
      })),
      highlights: Array.isArray(briefing?.highlights)
        ? briefing.highlights.map(String).slice(0, 8)
        : []
    }))
  }
  return `briefing-archive-v1:${hash.digest('hex')}`
}

function projectBriefingEvidence(value: any): any | null {
  if (!value || typeof value !== 'object') return null
  const sourceId = String(value.sourceId || 'wechat').slice(0, 100)
  const sessionId = String(value.sessionId || '').slice(0, 500)
  const messageId = String(value.messageId || '').slice(0, 500)
  const evidenceKey = String(value.evidenceKey || '').slice(0, 1_100)
  if (!sessionId || !messageId || !evidenceKey) return null
  return {
    evidenceKey,
    sourceId,
    messageId,
    sessionId,
    sessionName: String(value.sessionName || '').slice(0, 500),
    timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : 0,
    sender: String(value.sender || '').slice(0, 200),
    excerpt: String(value.excerpt || '').slice(0, 500)
  }
}

export function buildBriefingArchivePage(
  briefings: Record<string, any> | null | undefined,
  options: { offset?: number; limit?: number; revision?: string } = {}
): any {
  const source = briefings && typeof briefings === 'object' ? briefings : {}
  const entries = Object.entries(source)
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort(([left], [right]) => right.localeCompare(left))
  const revision = briefingArchiveRevision(entries)
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  const limit = Math.max(1, Math.min(14, Math.floor(Number(options.limit) || 7)))
  if (options.revision && options.revision !== revision) {
    return {
      items: [], total: entries.length, offset, limit, hasMore: false,
      nextOffset: offset, revision, stale: true
    }
  }
  const items = entries.slice(offset, offset + limit).map(([date, briefing]) => {
    const evidence = (Array.isArray(briefing?.summaryEvidence)
      ? briefing.summaryEvidence : [])
      .slice(0, 40)
      .map(projectBriefingEvidence)
      .filter(Boolean)
    const evidenceTotal = Math.max(
      evidence.length,
      Math.min(1_000_000, boundedCount(briefing?.summaryEvidenceTotal))
    )
    return {
      date,
      headline: String(briefing?.headline || '').slice(0, 300),
      summary: String(briefing?.summary || '').slice(0, 900),
      summaryVerified: briefing?.summaryVerified === true && evidence.length > 0,
      summaryEvidence: evidence,
      summaryEvidenceTotal: evidenceTotal,
      summaryEvidenceTruncated: evidenceTotal > evidence.length,
      highlights: (Array.isArray(briefing?.highlights) ? briefing.highlights : [])
        .map((value: any) => String(value || '').trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 8),
      messageCount: boundedCount(briefing?.messageCount),
      incrementCount: boundedCount(briefing?.incrementCount),
      lastIncrementMessageCount: boundedCount(briefing?.lastIncrementMessageCount),
      failedSessions: boundedCount(briefing?.failedSessions),
      failedSessionsTotal: boundedCount(briefing?.failedSessionsTotal),
      firstGeneratedAt: String(briefing?.firstGeneratedAt || '').slice(0, 100),
      generatedAt: String(briefing?.generatedAt || '').slice(0, 100)
    }
  })
  const nextOffset = offset + items.length
  return {
    items,
    total: entries.length,
    offset,
    limit,
    hasMore: nextOffset < entries.length,
    nextOffset,
    revision,
    stale: false
  }
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
import { createHash } from 'crypto'
