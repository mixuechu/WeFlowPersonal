export type ScheduledSyncAssessment = {
  complete: boolean
  reason: string
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
  completedAt: string
): {
  lastScheduledRunDate: string | null
  lastScheduledCompletedAt: string | null
  lastScheduledError: string | null
  scheduledRetryCount: number
} {
  if (assessment.complete) {
    return {
      lastScheduledRunDate: today,
      lastScheduledCompletedAt: completedAt,
      lastScheduledError: null,
      scheduledRetryCount: 0
    }
  }
  return {
    lastScheduledRunDate: previous?.lastScheduledRunDate || null,
    lastScheduledCompletedAt: previous?.lastScheduledCompletedAt || null,
    lastScheduledError: String(assessment.reason || '本次每日整理未完整成功'),
    scheduledRetryCount: Math.max(0, Number(previous?.scheduledRetryCount || 0)) + 1
  }
}
