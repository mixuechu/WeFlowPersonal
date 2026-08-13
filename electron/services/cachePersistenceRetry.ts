export const CACHE_PERSISTENCE_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  60_000,
  5 * 60_000,
  30 * 60_000
] as const

export type CachePersistenceRetryState = {
  failureCount: number
  lastErrorAt: string
  lastError: string
  nextAttemptAt: string
}

export const emptyCachePersistenceRetry = (): CachePersistenceRetryState => ({
  failureCount: 0,
  lastErrorAt: '',
  lastError: '',
  nextAttemptAt: ''
})

export const planCachePersistenceRetry = (
  current: CachePersistenceRetryState,
  error: unknown,
  now = new Date()
): CachePersistenceRetryState => {
  const failureCount = Math.min(1_000_000, Math.max(0, Number(current.failureCount || 0)) + 1)
  const delay = CACHE_PERSISTENCE_RETRY_DELAYS_MS[
    Math.min(failureCount - 1, CACHE_PERSISTENCE_RETRY_DELAYS_MS.length - 1)
  ]
  return {
    failureCount,
    lastErrorAt: now.toISOString(),
    lastError: sanitizeDiagnosticText(error).slice(0, 500),
    nextAttemptAt: new Date(now.getTime() + delay).toISOString()
  }
}

export const cachePersistenceRetryDelayMs = (
  state: CachePersistenceRetryState,
  nowMs = Date.now()
): number => {
  const next = Date.parse(state.nextAttemptAt)
  return Number.isFinite(next) ? Math.max(0, next - nowMs) : 0
}
import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'
