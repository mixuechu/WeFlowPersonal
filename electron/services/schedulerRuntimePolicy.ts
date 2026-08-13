const SCHEDULER_RETRY_MINUTES = [5, 15, 30, 60, 180, 360] as const

const safeCount = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(parsed)))
    : 0
}

const validIsoOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export type SchedulerRuntimeRetry = {
  failures: number
  lastFailureAt: string | null
  lastError: string | null
  nextAttemptAt: string | null
  lastRecoveredAt: string | null
}

export const EMPTY_SCHEDULER_RUNTIME_RETRY: SchedulerRuntimeRetry = {
  failures: 0,
  lastFailureAt: null,
  lastError: null,
  nextAttemptAt: null,
  lastRecoveredAt: null
}

export function normalizeSchedulerRuntimeRetry(raw: unknown): SchedulerRuntimeRetry {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  return {
    failures: safeCount(value.failures),
    lastFailureAt: validIsoOrNull(value.lastFailureAt),
    lastError: String(value.lastError || '').slice(0, 500) || null,
    nextAttemptAt: validIsoOrNull(value.nextAttemptAt),
    lastRecoveredAt: validIsoOrNull(value.lastRecoveredAt)
  }
}

export function schedulerRuntimeCoolingDown(
  retry: SchedulerRuntimeRetry,
  nowMs: number
): boolean {
  const parsed = Date.parse(String(retry.nextAttemptAt || ''))
  return Number.isFinite(parsed) && parsed > nowMs
}

export function planSchedulerRuntimeFailure(
  previous: SchedulerRuntimeRetry,
  now: Date,
  error: unknown
): SchedulerRuntimeRetry {
  const failures = Math.min(Number.MAX_SAFE_INTEGER, safeCount(previous.failures) + 1)
  const minutes = SCHEDULER_RETRY_MINUTES[
    Math.min(failures - 1, SCHEDULER_RETRY_MINUTES.length - 1)
  ]
  return {
    failures,
    lastFailureAt: now.toISOString(),
    lastError: String(error || '后台调度发生未预期错误').slice(0, 500),
    nextAttemptAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
    lastRecoveredAt: previous.lastRecoveredAt
  }
}

export function clearSchedulerRuntimeFailure(
  previous: SchedulerRuntimeRetry,
  now: Date
): SchedulerRuntimeRetry {
  return {
    ...EMPTY_SCHEDULER_RUNTIME_RETRY,
    lastRecoveredAt: previous.failures > 0 ? now.toISOString() : previous.lastRecoveredAt
  }
}
