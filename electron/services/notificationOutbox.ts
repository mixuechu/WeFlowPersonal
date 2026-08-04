export type AssistantNotification = {
  key: string
  title: string
  content: string
  createdAt: string
  attempts: number
  lastError?: string
}

export type NotificationOutbox = {
  pending: AssistantNotification[]
  sentKeys: string[]
}

export function enqueueUniqueNotification(
  outbox: NotificationOutbox,
  notification: Omit<AssistantNotification, 'attempts'>
): boolean {
  if (!notification.key || outbox.sentKeys.includes(notification.key) ||
      outbox.pending.some(item => item.key === notification.key)) return false
  outbox.pending.push({ ...notification, attempts: 0 })
  outbox.pending = outbox.pending.slice(-100)
  return true
}

export function markNotificationAttempt(
  outbox: NotificationOutbox,
  key: string,
  result: { success: boolean; error?: string }
): void {
  const item = outbox.pending.find(notification => notification.key === key)
  if (!item) return
  if (result.success) {
    outbox.pending = outbox.pending.filter(notification => notification.key !== key)
    outbox.sentKeys = [...new Set([...outbox.sentKeys, key])].slice(-500)
    return
  }
  item.attempts = Math.max(0, Number(item.attempts) || 0) + 1
  item.lastError = String(result.error || '系统通知发送失败').slice(0, 300)
}

export async function deliverNotificationBatch(
  outbox: NotificationOutbox,
  deliver: (notification: AssistantNotification) => Promise<void>,
  options: {
    limit?: number
    normalizeError?: (error: unknown) => string
    onAttempt?: (notification: AssistantNotification, success: boolean) => void | Promise<void>
  } = {}
): Promise<{ attempted: number; sent: number; failed: number }> {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 5)))
  const batch = [...outbox.pending].slice(0, limit)
  let sent = 0
  let failed = 0
  for (const notification of batch) {
    let success = false
    try {
      await deliver(notification)
      markNotificationAttempt(outbox, notification.key, { success: true })
      sent += 1
      success = true
    } catch (error) {
      markNotificationAttempt(outbox, notification.key, {
        success: false,
        error: options.normalizeError ? options.normalizeError(error) : String(error)
      })
      failed += 1
    }
    await options.onAttempt?.(notification, success)
  }
  return { attempted: batch.length, sent, failed }
}
