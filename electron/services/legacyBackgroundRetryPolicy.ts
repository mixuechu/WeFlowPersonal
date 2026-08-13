import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'

const RETRY_MINUTES = [5, 15, 30, 60, 180, 360] as const

export const LEGACY_BACKGROUND_TASK_KINDS = [
  'insight',
  'groupSummary',
  'messagePush'
] as const

export type LegacyBackgroundTaskKind = typeof LEGACY_BACKGROUND_TASK_KINDS[number]

export type LegacyBackgroundRetry = {
  failures: number
  lastFailureAt: string | null
  lastError: string | null
  nextAttemptAt: string | null
  lastRecoveredAt: string | null
}

export type LegacyBackgroundRetries = Record<LegacyBackgroundTaskKind, LegacyBackgroundRetry>

export const emptyLegacyBackgroundRetry = (): LegacyBackgroundRetry => ({
  failures: 0,
  lastFailureAt: null,
  lastError: null,
  nextAttemptAt: null,
  lastRecoveredAt: null
})

export const emptyLegacyBackgroundRetries = (): LegacyBackgroundRetries => ({
  insight: emptyLegacyBackgroundRetry(),
  groupSummary: emptyLegacyBackgroundRetry(),
  messagePush: emptyLegacyBackgroundRetry()
})

const safeCount = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(1_000_000, Math.max(0, Math.floor(parsed)))
    : 0
}

const validIsoOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export const normalizeLegacyBackgroundRetry = (raw: unknown): LegacyBackgroundRetry => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    failures: safeCount(value.failures),
    lastFailureAt: validIsoOrNull(value.lastFailureAt),
    lastError: sanitizeDiagnosticText(value.lastError).slice(0, 500) || null,
    nextAttemptAt: validIsoOrNull(value.nextAttemptAt),
    lastRecoveredAt: validIsoOrNull(value.lastRecoveredAt)
  }
}

export const normalizeLegacyBackgroundRetries = (raw: unknown): LegacyBackgroundRetries => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    insight: normalizeLegacyBackgroundRetry(value.insight),
    groupSummary: normalizeLegacyBackgroundRetry(value.groupSummary),
    messagePush: normalizeLegacyBackgroundRetry(value.messagePush)
  }
}

export const legacyBackgroundRetryDelayMs = (
  retry: LegacyBackgroundRetry,
  nowMs = Date.now()
): number => {
  const retryAt = Date.parse(String(retry.nextAttemptAt || ''))
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : 0
}

export const planLegacyBackgroundFailure = (
  previous: LegacyBackgroundRetry,
  error: unknown,
  now = new Date()
): LegacyBackgroundRetry => {
  const failures = Math.min(1_000_000, safeCount(previous.failures) + 1)
  const delayMinutes = RETRY_MINUTES[Math.min(failures - 1, RETRY_MINUTES.length - 1)]
  return {
    failures,
    lastFailureAt: now.toISOString(),
    lastError: sanitizeDiagnosticText(error).slice(0, 500) || '辅助 AI 后台任务失败',
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
    lastRecoveredAt: previous.lastRecoveredAt
  }
}

export const clearLegacyBackgroundFailure = (
  previous: LegacyBackgroundRetry,
  now = new Date()
): LegacyBackgroundRetry => ({
  ...emptyLegacyBackgroundRetry(),
  lastRecoveredAt: previous.failures > 0 ? now.toISOString() : previous.lastRecoveredAt
})
