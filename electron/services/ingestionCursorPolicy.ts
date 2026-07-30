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

export function planSessionCursorProgress(input: {
  current: Record<string, number>
  successfulSessionIds: string[]
  failedSessionIds: string[]
  windowEnd: number
  modelBatchesSucceeded: boolean
}): {
  sessionCursors: Record<string, number>
  advanceGlobal: boolean
  complete: boolean
  pendingSessionIds: string[]
} {
  const sessionCursors = { ...(input.current || {}) }
  const windowEnd = Math.max(0, Math.floor(Number(input.windowEnd) || 0))
  const pendingSessionIds = [...new Set((input.failedSessionIds || [])
    .map(value => String(value || '').trim()).filter(Boolean))]
  if (input.modelBatchesSucceeded) {
    for (const rawId of input.successfulSessionIds || []) {
      const sessionId = String(rawId || '').trim()
      if (sessionId) sessionCursors[sessionId] = windowEnd
    }
  }
  return {
    sessionCursors,
    advanceGlobal: Boolean(input.modelBatchesSucceeded),
    complete: Boolean(input.modelBatchesSucceeded && pendingSessionIds.length === 0),
    pendingSessionIds
  }
}
