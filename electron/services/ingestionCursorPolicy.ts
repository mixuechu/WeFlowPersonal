export function initializeSessionRetryCursors(
  current: Record<string, number>,
  sessionIds: string[],
  windowStart: number
): {
  sessionCursors: Record<string, number>
  initialized: string[]
} {
  const sessionCursors = { ...(current || {}) }
  const initialized: string[] = []
  const safeStart = Math.max(0, Math.floor(Number(windowStart) || 0))
  for (const rawId of sessionIds || []) {
    const sessionId = String(rawId || '').trim()
    if (!sessionId || Object.prototype.hasOwnProperty.call(sessionCursors, sessionId)) continue
    sessionCursors[sessionId] = safeStart
    initialized.push(sessionId)
  }
  return { sessionCursors, initialized }
}

export function nextSessionContinuationOffset(
  persistedOffset: number,
  nextOffset: number,
  hasMore: boolean,
  overlap = 20
): number {
  if (!hasMore) return 0
  const persisted = Math.max(0, Math.floor(Number(persistedOffset) || 0))
  const next = Math.max(0, Math.floor(Number(nextOffset) || 0))
  const safeOverlap = Math.max(0, Math.min(100, Math.floor(Number(overlap) || 0)))
  return Math.max(persisted, next - safeOverlap)
}

export function planSessionCursorProgress(input: {
  current: Record<string, number>
  currentOffsets?: Record<string, number>
  successfulSessionIds: string[]
  failedSessionIds: string[]
  continuationOffsets?: Record<string, number>
  windowEnd: number
  modelBatchesSucceeded: boolean
}): {
  sessionCursors: Record<string, number>
  sessionOffsets: Record<string, number>
  advanceGlobal: boolean
  complete: boolean
  pendingSessionIds: string[]
  backlogSessionIds: string[]
} {
  const sessionCursors = { ...(input.current || {}) }
  const sessionOffsets = { ...(input.currentOffsets || {}) }
  const windowEnd = Math.max(0, Math.floor(Number(input.windowEnd) || 0))
  const pendingSessionIds = [...new Set((input.failedSessionIds || [])
    .map(value => String(value || '').trim()).filter(Boolean))]
  if (input.modelBatchesSucceeded) {
    for (const rawId of input.successfulSessionIds || []) {
      const sessionId = String(rawId || '').trim()
      if (!sessionId) continue
      const continuationOffset = Math.max(0,
        Math.floor(Number(input.continuationOffsets?.[sessionId]) || 0))
      if (continuationOffset > 0) {
        sessionOffsets[sessionId] = continuationOffset
      } else {
        sessionCursors[sessionId] = windowEnd
        delete sessionOffsets[sessionId]
      }
    }
  }
  const backlogSessionIds = Object.keys(sessionOffsets)
    .filter(sessionId => Number(sessionOffsets[sessionId]) > 0)
    .sort()
  return {
    sessionCursors,
    sessionOffsets,
    advanceGlobal: Boolean(input.modelBatchesSucceeded),
    complete: Boolean(
      input.modelBatchesSucceeded &&
      pendingSessionIds.length === 0 &&
      backlogSessionIds.length === 0
    ),
    pendingSessionIds,
    backlogSessionIds
  }
}
