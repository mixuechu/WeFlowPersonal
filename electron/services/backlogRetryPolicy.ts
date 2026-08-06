export type BacklogRetryState = {
  nextAttemptAt: string | null
  failureCount: number
  paused: boolean
  lastAttemptAt: string | null
  lastProgressAt: string | null
  lastOutcome: 'idle' | 'progressed' | 'waiting' | 'failed' | 'paused' | 'drained'
  previousBacklogCount: number
  remainingBacklogCount: number
}

export const EMPTY_BACKLOG_RETRY_STATE: BacklogRetryState = {
  nextAttemptAt: null,
  failureCount: 0,
  paused: false,
  lastAttemptAt: null,
  lastProgressAt: null,
  lastOutcome: 'idle',
  previousBacklogCount: 0,
  remainingBacklogCount: 0
}

function normalizedOffsets(offsets: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(offsets || {})
    .map(([sessionId, value]) => [String(sessionId), Math.max(0, Math.floor(Number(value) || 0))])
    .filter(([, value]) => value > 0))
}

export function didBacklogProgress(
  previousOffsets: Record<string, number> | undefined,
  currentOffsets: Record<string, number> | undefined
): boolean {
  const previous = normalizedOffsets(previousOffsets)
  const current = normalizedOffsets(currentOffsets)
  return Object.entries(previous).some(([sessionId, offset]) =>
    !current[sessionId] || current[sessionId] > offset) ||
    Object.entries(current).some(([sessionId, offset]) =>
      !previous[sessionId] || offset > previous[sessionId])
}

export function planBacklogRetry(input: {
  previous: BacklogRetryState
  previousOffsets?: Record<string, number>
  currentOffsets?: Record<string, number>
  now: Date
  operationalFailure: boolean
  cancelled: boolean
  baseDelayMs?: number
  maxDelayMs?: number
}): BacklogRetryState {
  const current = normalizedOffsets(input.currentOffsets)
  const previous = normalizedOffsets(input.previousOffsets)
  const nowIso = input.now.toISOString()
  if (!Object.keys(current).length) {
    const drained = Object.keys(previous).length > 0
    return {
      ...EMPTY_BACKLOG_RETRY_STATE,
      lastAttemptAt: nowIso,
      lastProgressAt: drained ? nowIso : input.previous.lastProgressAt,
      lastOutcome: drained ? 'drained' : 'idle',
      previousBacklogCount: Object.keys(previous).length
    }
  }
  const progressed = didBacklogProgress(input.previousOffsets, current)
  const previousBacklogCount = Object.keys(previous).length
  const remainingBacklogCount = Object.keys(current).length
  if (input.cancelled) {
    return {
      ...input.previous,
      nextAttemptAt: null,
      paused: true,
      lastAttemptAt: nowIso,
      lastProgressAt: progressed ? nowIso : input.previous.lastProgressAt,
      lastOutcome: 'paused',
      previousBacklogCount,
      remainingBacklogCount
    }
  }
  const baseDelayMs = Math.max(60_000, Number(input.baseDelayMs || 15 * 60_000))
  const maxDelayMs = Math.max(baseDelayMs, Number(input.maxDelayMs || 6 * 60 * 60_000))
  const failureCount = input.operationalFailure && !progressed
    ? Math.min(20, Math.max(0, Number(input.previous.failureCount) || 0) + 1)
    : 0
  const delayMs = failureCount
    ? Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, failureCount - 1)))
    : baseDelayMs
  return {
    nextAttemptAt: new Date(input.now.getTime() + delayMs).toISOString(),
    failureCount,
    paused: false,
    lastAttemptAt: nowIso,
    lastProgressAt: progressed ? nowIso : input.previous.lastProgressAt,
    lastOutcome: progressed ? 'progressed' : input.operationalFailure ? 'failed' : 'waiting',
    previousBacklogCount,
    remainingBacklogCount
  }
}

export function isBacklogRetryDue(input: {
  state: BacklogRetryState
  offsets?: Record<string, number>
  sourceEnabled: boolean
  now: Date
}): boolean {
  if (!input.sourceEnabled || input.state.paused || !Object.keys(normalizedOffsets(input.offsets)).length) {
    return false
  }
  const dueAt = input.state.nextAttemptAt ? Date.parse(input.state.nextAttemptAt) : Number.NaN
  return Number.isFinite(dueAt) && input.now.getTime() >= dueAt
}
