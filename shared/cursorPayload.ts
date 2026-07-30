export const CURSOR_STATUS_PAYLOAD_VERSION = 'cursor-status-v1'

export function buildCursorStatusPayload(cursor: any): any {
  const recentMessageIds = Array.isArray(cursor?.recentMessageIds) ? cursor.recentMessageIds : []
  const sessionCursors = cursor?.sessionCursors && typeof cursor.sessionCursors === 'object'
    ? cursor.sessionCursors
    : {}
  const sessionOffsets = cursor?.sessionOffsets && typeof cursor.sessionOffsets === 'object'
    ? cursor.sessionOffsets
    : {}
  return {
    lastMessageTimestamp: Number(cursor?.lastMessageTimestamp || 0),
    lastSuccessfulRunAt: cursor?.lastSuccessfulRunAt || null,
    lastScheduledRunDate: cursor?.lastScheduledRunDate || null,
    lastReminderNotificationDate: cursor?.lastReminderNotificationDate || null,
    lastAttemptAt: cursor?.lastAttemptAt || null,
    lastError: cursor?.lastError || null,
    pendingSessionRetryCount: Number(cursor?.pendingSessionRetryCount || 0),
    pendingSessionBacklogCount: Number(cursor?.pendingSessionBacklogCount || 0),
    backlogRetry: {
      nextAttemptAt: cursor?.backlogRetry?.nextAttemptAt || null,
      failureCount: Number(cursor?.backlogRetry?.failureCount || 0),
      paused: Boolean(cursor?.backlogRetry?.paused),
      lastProgressAt: cursor?.backlogRetry?.lastProgressAt || null
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
