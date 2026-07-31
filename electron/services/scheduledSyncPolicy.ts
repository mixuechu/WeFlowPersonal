export type ScheduledSyncAssessment = {
  complete: boolean
  reason: string
}

const SCHEDULED_RETRY_BASE_MS = 15 * 60_000
const SCHEDULED_RETRY_MAX_MS = 6 * 60 * 60_000

export function scheduledSyncRetryDelayMs(retryCount: number): number {
  const exponent = Math.max(0, Math.floor(Number(retryCount || 1)) - 1)
  return Math.min(SCHEDULED_RETRY_MAX_MS, SCHEDULED_RETRY_BASE_MS * (2 ** exponent))
}

export function shouldReconcileScheduledSync(trigger: string, previous: any): boolean {
  return trigger !== 'daily' && Boolean(previous?.lastScheduledError)
}

export function scheduledSyncTargetTimestamp(lastScheduledAttemptAt: unknown, fallbackMs: number): number {
  const attemptedAt = Date.parse(String(lastScheduledAttemptAt || ''))
  return Number.isFinite(attemptedAt) ? attemptedAt : fallbackMs
}

export function assessScheduledSyncResult(result: any): ScheduledSyncAssessment {
  if (!result || result.success !== true) {
    const sourceError = [
      result?.documentSourceError,
      result?.calendarSourceError,
      result?.mailSourceError
    ].map(value => String(value || '').trim()).find(Boolean)
    return {
      complete: false,
      reason: sourceError || String(result?.message || '').trim() || '本次每日整理未完整成功'
    }
  }
  if (result.cancelled) return { complete: false, reason: '本次每日整理已安全暂停' }
  if (result.partial) {
    return {
      complete: false,
      reason: String(result.message || '').trim() || '仍有增量分页或批次等待补齐'
    }
  }
  const sourceError = [
    result.documentSourceError,
    result.calendarSourceError,
    result.mailSourceError
  ].map(value => String(value || '').trim()).find(Boolean)
  if (sourceError) return { complete: false, reason: sourceError }
  return { complete: true, reason: '' }
}

export function planScheduledSyncState(
  previous: any,
  assessment: ScheduledSyncAssessment,
  today: string,
  observedAt: string
): {
  lastScheduledRunDate: string | null
  lastScheduledCompletedAt: string | null
  lastScheduledError: string | null
  scheduledRetryCount: number
  nextScheduledRetryAt: string | null
  pendingScheduledRunDate: string | null
} {
  if (assessment.complete) {
    return {
      lastScheduledRunDate: today,
      lastScheduledCompletedAt: observedAt,
      lastScheduledError: null,
      scheduledRetryCount: 0,
      nextScheduledRetryAt: null,
      pendingScheduledRunDate: null
    }
  }
  const scheduledRetryCount = Math.max(0, Number(previous?.scheduledRetryCount || 0)) + 1
  return {
    lastScheduledRunDate: previous?.lastScheduledRunDate || null,
    lastScheduledCompletedAt: previous?.lastScheduledCompletedAt || null,
    lastScheduledError: String(assessment.reason || '本次每日整理未完整成功'),
    scheduledRetryCount,
    nextScheduledRetryAt: new Date(
      Date.parse(observedAt) + scheduledSyncRetryDelayMs(scheduledRetryCount)
    ).toISOString(),
    pendingScheduledRunDate: today
  }
}
