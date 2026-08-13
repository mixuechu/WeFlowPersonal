const RESOURCE_CONTENT_BUDGET_RETRY_MINUTES = [5, 15, 30, 60, 180, 360] as const

const safeCount = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(parsed)))
    : 0
}

const validIsoOrEmpty = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

export type ResourceContentBudgetMigrationHealth = {
  version: 'resource-content-budget-migration-v2'
  checkedAt: string
  batchLimit: number
  checked: number
  repaired: number
  truncated: number
  boundaryUnknown: number
  remaining: number
  failureStreak: number
  lastErrorAt: string
  lastError: string
  nextAttemptAt: string
}

export function normalizeResourceContentBudgetMigrationHealth(
  raw: unknown
): ResourceContentBudgetMigrationHealth {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  return {
    version: 'resource-content-budget-migration-v2',
    checkedAt: validIsoOrEmpty(value.checkedAt),
    batchLimit: safeCount(value.batchLimit),
    checked: safeCount(value.checked),
    repaired: safeCount(value.repaired),
    truncated: safeCount(value.truncated),
    boundaryUnknown: safeCount(value.boundaryUnknown),
    remaining: safeCount(value.remaining),
    failureStreak: safeCount(value.failureStreak),
    lastErrorAt: validIsoOrEmpty(value.lastErrorAt),
    lastError: String(value.lastError || '').slice(0, 500),
    nextAttemptAt: validIsoOrEmpty(value.nextAttemptAt)
  }
}

export function planResourceContentBudgetRetry(
  previousFailures: unknown,
  now: Date
): { failureStreak: number; nextAttemptAt: string } {
  const failureStreak = Math.min(Number.MAX_SAFE_INTEGER, safeCount(previousFailures) + 1)
  const delayMinutes = RESOURCE_CONTENT_BUDGET_RETRY_MINUTES[
    Math.min(failureStreak - 1, RESOURCE_CONTENT_BUDGET_RETRY_MINUTES.length - 1)
  ]
  return {
    failureStreak,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString()
  }
}

export function resourceContentBudgetRetryCoolingDown(
  nextAttemptAt: unknown,
  nowMs: number
): boolean {
  const parsed = Date.parse(String(nextAttemptAt || ''))
  return Number.isFinite(parsed) && parsed > nowMs
}
