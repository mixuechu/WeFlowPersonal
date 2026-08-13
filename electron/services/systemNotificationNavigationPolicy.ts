export type SystemNotificationNavigationInput = {
  sessionId?: string
  channel?: string
  insightRecordId?: string
  targetRoute?: string
}

export function buildSystemNotificationActionPayload(
  data: SystemNotificationNavigationInput
): unknown | null {
  const targetRoute = String(data.targetRoute || '').trim()
  if (targetRoute || data.channel || data.insightRecordId) {
    return {
      sessionId: data.sessionId,
      channel: data.channel,
      insightRecordId: data.insightRecordId,
      targetRoute: targetRoute || undefined
    }
  }
  return data.sessionId || null
}
