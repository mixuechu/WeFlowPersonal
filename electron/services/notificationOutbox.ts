export type AssistantNotification = {
  key: string
  title: string
  content: string
  createdAt: string
  attempts: number
  lastError?: string
  lastAttemptAt?: string
  nextAttemptAt?: string
}

export type NotificationOutbox = {
  pending: AssistantNotification[]
  sentKeys: string[]
  discardedPendingCount?: number
  lastDiscardedPendingAt?: string
  prunedSentKeyCount?: number
}

export function notificationRetryDelayMs(attempts: number): number {
  const minutes = [15, 30, 60, 120, 240, 360]
  return minutes[Math.min(minutes.length - 1, Math.max(0, Math.floor(attempts) - 1))] * 60_000
}

export function notificationIsDue(notification: AssistantNotification, now: Date): boolean {
  const nextAttemptAt = Date.parse(String(notification.nextAttemptAt || ''))
  return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now.getTime()
}

export function enqueueUniqueNotification(
  outbox: NotificationOutbox,
  notification: Omit<AssistantNotification, 'attempts'>
): boolean {
  if (!notification.key || outbox.sentKeys.includes(notification.key) ||
      outbox.pending.some(item => item.key === notification.key)) return false
  outbox.pending.push({ ...notification, attempts: 0 })
  if (outbox.pending.length > 100) {
    const discarded = outbox.pending.length - 100
    outbox.pending = outbox.pending.slice(-100)
    outbox.discardedPendingCount = Math.max(0, Number(outbox.discardedPendingCount) || 0) + discarded
    outbox.lastDiscardedPendingAt = new Date().toISOString()
  }
  return true
}

export function markNotificationAttempt(
  outbox: NotificationOutbox,
  key: string,
  result: { success: boolean; error?: string },
  now = new Date()
): void {
  const item = outbox.pending.find(notification => notification.key === key)
  if (!item) return
  if (result.success) {
    outbox.pending = outbox.pending.filter(notification => notification.key !== key)
    const sentKeys = [...new Set([...outbox.sentKeys, key])]
    if (sentKeys.length > 500) {
      outbox.prunedSentKeyCount = Math.max(0, Number(outbox.prunedSentKeyCount) || 0) +
        (sentKeys.length - 500)
    }
    outbox.sentKeys = sentKeys.slice(-500)
    return
  }
  item.attempts = Math.max(0, Number(item.attempts) || 0) + 1
  item.lastError = String(result.error || '系统通知发送失败').slice(0, 300)
  item.lastAttemptAt = now.toISOString()
  item.nextAttemptAt = new Date(now.getTime() + notificationRetryDelayMs(item.attempts)).toISOString()
}

export async function deliverNotificationBatch(
  outbox: NotificationOutbox,
  deliver: (notification: AssistantNotification) => Promise<void>,
  options: {
    limit?: number
    now?: Date
    normalizeError?: (error: unknown) => string
    onAttempt?: (notification: AssistantNotification, success: boolean) => void | Promise<void>
  } = {}
): Promise<{ attempted: number; sent: number; failed: number }> {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 5)))
  const now = options.now || new Date()
  const batch = outbox.pending.filter(notification => notificationIsDue(notification, now)).slice(0, limit)
  let sent = 0
  let failed = 0
  for (const notification of batch) {
    let success = false
    try {
      await deliver(notification)
      markNotificationAttempt(outbox, notification.key, { success: true }, now)
      sent += 1
      success = true
    } catch (error) {
      markNotificationAttempt(outbox, notification.key, {
        success: false,
        error: options.normalizeError ? options.normalizeError(error) : String(error)
      }, now)
      failed += 1
    }
    await options.onAttempt?.(notification, success)
  }
  return { attempted: batch.length, sent, failed }
}
