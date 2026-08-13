const RETRY_MINUTES = [5, 15, 30, 60, 180, 360] as const

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

export type ResourceEnrichmentSchedulerRetry = {
  failures: number
  lastAttemptAt: string | null
  lastError: string | null
  nextAttemptAt: string | null
}

export const EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY: ResourceEnrichmentSchedulerRetry = {
  failures: 0,
  lastAttemptAt: null,
  lastError: null,
  nextAttemptAt: null
}

export function normalizeResourceEnrichmentSchedulerRetry(
  raw: unknown
): ResourceEnrichmentSchedulerRetry {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  return {
    failures: safeCount(value.failures),
    lastAttemptAt: validIsoOrNull(value.lastAttemptAt),
    lastError: String(value.lastError || '').slice(0, 500) || null,
    nextAttemptAt: validIsoOrNull(value.nextAttemptAt)
  }
}

export function resourceEnrichmentDiscoveryCoolingDown(
  retry: ResourceEnrichmentSchedulerRetry,
  nowMs: number
): boolean {
  const parsed = Date.parse(String(retry.nextAttemptAt || ''))
  return Number.isFinite(parsed) && parsed > nowMs
}

export function planResourceEnrichmentDiscoveryFailure(
  previous: ResourceEnrichmentSchedulerRetry,
  now: Date,
  error: unknown
): ResourceEnrichmentSchedulerRetry {
  const failures = Math.min(Number.MAX_SAFE_INTEGER, safeCount(previous.failures) + 1)
  const delayMinutes = RETRY_MINUTES[Math.min(failures - 1, RETRY_MINUTES.length - 1)]
  return {
    failures,
    lastAttemptAt: now.toISOString(),
    lastError: String(error || '资源补全队列检查失败').slice(0, 500),
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString()
  }
}
