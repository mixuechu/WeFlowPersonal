export function includeContinuationSessions(
  sessions: any[],
  sessionOffsets: Record<string, number> | undefined,
  fallbackTimestamp: number
): any[] {
  const result = Array.isArray(sessions) ? [...sessions] : []
  const known = new Set(result.map(session => String(session?.username || '')).filter(Boolean))
  for (const [rawSessionId, rawOffset] of Object.entries(sessionOffsets || {})) {
    const sessionId = String(rawSessionId || '').trim()
    const offset = Math.max(0, Math.floor(Number(rawOffset) || 0))
    if (!sessionId || !offset || known.has(sessionId)) continue
    result.push({
      username: sessionId,
      displayName: sessionId,
      type: sessionId.endsWith('@chatroom') ? 'group' : 'private',
      sessionType: sessionId.endsWith('@chatroom') ? 'group' : 'private',
      lastTimestamp: fallbackTimestamp,
      continuationRecovered: true
    })
    known.add(sessionId)
  }
  return result
}

export async function settleWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const source = Array.isArray(items) ? items : []
  const results = new Array<PromiseSettledResult<R>>(source.length)
  const workerCount = Math.min(
    source.length,
    Math.max(1, Math.min(32, Math.floor(Number(concurrency) || 1)))
  )
  let nextIndex = 0
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { status: 'fulfilled', value: await mapper(source[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))
  return results
}
