export const CURSOR_STATUS_PAYLOAD_VERSION = 'cursor-status-v3'

export function buildCursorStatusPayload(cursor: any): any {
  const recentMessageIds = Array.isArray(cursor?.recentMessageIds) ? cursor.recentMessageIds : []
  const sessionCursors = cursor?.sessionCursors && typeof cursor.sessionCursors === 'object'
    ? cursor.sessionCursors
    : {}
  const sessionOffsets = cursor?.sessionOffsets && typeof cursor.sessionOffsets === 'object'
    ? cursor.sessionOffsets
    : {}
  const lastScheduledAttemptAt = cursor?.lastScheduledAttemptAt || null
  const scheduledRetryCount = Number(cursor?.scheduledRetryCount || 0)
  const persistedRetryAt = cursor?.nextScheduledRetryAt || null
  const legacyRetryTimestamp = !persistedRetryAt && lastScheduledAttemptAt && cursor?.lastScheduledError
    ? Date.parse(lastScheduledAttemptAt) + 15 * 60_000
    : NaN
  return {
    lastMessageTimestamp: Number(cursor?.lastMessageTimestamp || 0),
    lastSuccessfulRunAt: cursor?.lastSuccessfulRunAt || null,
    lastScheduledRunDate: cursor?.lastScheduledRunDate || null,
    lastScheduledAttemptAt,
    lastScheduledCompletedAt: cursor?.lastScheduledCompletedAt || null,
    lastScheduledError: cursor?.lastScheduledError || null,
    scheduledRetryCount,
    nextScheduledRetryAt: persistedRetryAt || (Number.isFinite(legacyRetryTimestamp)
      ? new Date(legacyRetryTimestamp).toISOString()
      : null),
    systemWake: {
      lastSuspendAt: cursor?.lastSystemSuspendAt || null,
      lastResumeAt: cursor?.lastSystemResumeAt || null,
      resumeCount: Number(cursor?.systemResumeCount || 0),
      lastWakeAt: cursor?.lastSchedulerWakeAt || null,
      lastWakeReason: cursor?.lastSchedulerWakeReason || null,
      lastGapMs: Number(cursor?.lastSchedulerGapMs || 0),
      lastCatchupAt: cursor?.lastResumeCatchupAt || null,
      lastCatchupResult: cursor?.lastResumeCatchupResult || null,
      retry: {
        pendingSince: cursor?.resumeCatchupRetry?.pendingSince || null,
        lastAttemptAt: cursor?.resumeCatchupRetry?.lastAttemptAt || null,
        nextAttemptAt: cursor?.resumeCatchupRetry?.nextAttemptAt || null,
        failureCount: Number(cursor?.resumeCatchupRetry?.failureCount || 0),
        lastError: cursor?.resumeCatchupRetry?.lastError || null
      }
    },
    lastReminderNotificationDate: cursor?.lastReminderNotificationDate || null,
    lastAttemptAt: cursor?.lastAttemptAt || null,
    lastError: cursor?.lastError || null,
    pendingSessionRetryCount: Number(cursor?.pendingSessionRetryCount || 0),
    pendingSessionBacklogCount: Number(cursor?.pendingSessionBacklogCount || 0),
    backlogRetry: {
      nextAttemptAt: cursor?.backlogRetry?.nextAttemptAt || null,
      failureCount: Number(cursor?.backlogRetry?.failureCount || 0),
      paused: Boolean(cursor?.backlogRetry?.paused),
      lastAttemptAt: cursor?.backlogRetry?.lastAttemptAt || null,
      lastProgressAt: cursor?.backlogRetry?.lastProgressAt || null,
      lastOutcome: cursor?.backlogRetry?.lastOutcome || 'idle',
      previousBacklogCount: Number(cursor?.backlogRetry?.previousBacklogCount || 0),
      remainingBacklogCount: Number(cursor?.backlogRetry?.remainingBacklogCount || 0)
    },
    privateStateCounts: {
      recentMessageKeys: recentMessageIds.length,
      sessionCursors: Object.keys(sessionCursors).length,
      continuationOffsets: Object.keys(sessionOffsets)
        .filter(sessionId => Number(sessionOffsets[sessionId]) > 0).length
    },
    payloadPolicy: {
      version: CURSOR_STATUS_PAYLOAD_VERSION,
      durableKeys: 'main_process_only',
      sessionMaps: 'main_process_only'
    }
  }
}
