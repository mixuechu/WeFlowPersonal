export function buildOverlappingAnalysisBatches(
  messages: any[],
  options: {
    messageKey: (message: any) => string
    forcedContextKeys?: Set<string>
    coreSize?: number
    overlap?: number
    maxBatchSize?: number
  }
): any[][] {
  const coreSize = Math.max(1, Math.min(500, Number(options.coreSize || 100)))
  const overlap = Math.max(0, Math.min(100, Number(options.overlap ?? 20)))
  const maxBatchSize = Math.max(coreSize, Math.min(1_000, Number(options.maxBatchSize || 160)))
  const forcedContextKeys = options.forcedContextKeys || new Set<string>()
  const bySession = new Map<string, any[]>()
  for (const message of messages || []) {
    const rows = bySession.get(String(message.sessionId || '')) || []
    rows.push(message)
    bySession.set(String(message.sessionId || ''), rows)
  }
  const windows: Array<{ sessionId: string; rows: any[] }> = []
  for (const [sessionId, rows] of bySession.entries()) {
    rows.sort((left, right) =>
      Number(left.timestamp || 0) - Number(right.timestamp || 0) ||
      options.messageKey(left).localeCompare(options.messageKey(right)))
    const coreRows = rows.filter(message => !forcedContextKeys.has(options.messageKey(message)))
    for (let coreStart = 0; coreStart < coreRows.length; coreStart += coreSize) {
      const coreChunk = coreRows.slice(coreStart, coreStart + coreSize)
      const coreKeys = new Set(coreChunk.map(options.messageKey))
      const firstIndex = rows.findIndex(message => coreKeys.has(options.messageKey(message)))
      let lastIndex = -1
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (coreKeys.has(options.messageKey(rows[index]))) {
          lastIndex = index
          break
        }
      }
      if (firstIndex < 0 || lastIndex < firstIndex) continue
      windows.push({
        sessionId,
        rows: rows
          .slice(Math.max(0, firstIndex - overlap), Math.min(rows.length, lastIndex + overlap + 1))
          .map(message => ({
            ...message,
            analysisScope: coreKeys.has(options.messageKey(message)) &&
              !forcedContextKeys.has(options.messageKey(message))
              ? 'core'
              : 'context'
          }))
      })
    }
  }
  const batches: any[][] = []
  let pending: any[] = []
  const pendingSessions = new Set<string>()
  for (const window of windows) {
    if (pending.length &&
      (pending.length + window.rows.length > maxBatchSize || pendingSessions.has(window.sessionId))) {
      batches.push(pending)
      pending = []
      pendingSessions.clear()
    }
    pending.push(...window.rows)
    pendingSessions.add(window.sessionId)
  }
  if (pending.length) batches.push(pending)
  return batches
}
