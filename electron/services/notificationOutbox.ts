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
  item.attempts += 1
  item.lastError = String(result.error || '系统通知发送失败').slice(0, 300)
}
