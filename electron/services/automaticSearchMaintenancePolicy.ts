export const AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60_000
export const AUTOMATIC_SEARCH_MAINTENANCE_RETRY_MS = 6 * 60 * 60_000

function timestamp(value: unknown): number | null {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function assessAutomaticSearchMaintenance(input: {
  nowMs: number
  checkedAt?: string | null
  lastAttemptAt?: string | null
  lastError?: string | null
  idle: boolean
}): {
  due: boolean
  reason: 'not_idle' | 'fresh' | 'retry_cooling_down' | 'overdue' | 'missing_audit'
  nextAt: string | null
} {
  if (!input.idle) return { due: false, reason: 'not_idle', nextAt: null }
  const checkedAt = timestamp(input.checkedAt)
  const lastAttemptAt = timestamp(input.lastAttemptAt)
  const nowMs = Number(input.nowMs)
  if (
    String(input.lastError || '').trim()
    && lastAttemptAt !== null
    && (checkedAt === null || checkedAt <= lastAttemptAt)
  ) {
    const retryAt = lastAttemptAt + AUTOMATIC_SEARCH_MAINTENANCE_RETRY_MS
    if (nowMs < retryAt) {
      return {
        due: false,
        reason: 'retry_cooling_down',
        nextAt: new Date(retryAt).toISOString()
      }
    }
  }
  if (checkedAt === null) return { due: true, reason: 'missing_audit', nextAt: null }
  const nextAtMs = checkedAt + AUTOMATIC_SEARCH_MAINTENANCE_INTERVAL_MS
  if (nowMs < nextAtMs) {
    return { due: false, reason: 'fresh', nextAt: new Date(nextAtMs).toISOString() }
  }
  return { due: true, reason: 'overdue', nextAt: null }
}
