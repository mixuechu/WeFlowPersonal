import { createHash } from 'node:crypto'

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
  identityMigrationCount?: number
  discardedInvalidCount?: number
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function buildNotificationDedupKey(kind: string, identities: string[]): string {
  const normalizedKind = String(kind || 'notification').trim().replace(/[^a-z0-9_-]/gi, '-').slice(0, 32) ||
    'notification'
  const normalizedIdentities = [...new Set(identities.map(value => String(value || '').trim()).filter(Boolean))].sort()
  return `${normalizedKind}:v2:${sha256(JSON.stringify(normalizedIdentities))}`
}

function normalizeNotificationKey(value: unknown): { key: string; migrated: boolean } | null {
  const key = String(value || '').trim()
  if (!key) return null
  if (/^[a-z0-9_-]{1,32}:v2:[a-f0-9]{64}$/i.test(key)) return { key, migrated: false }
  if (key.startsWith('new-tasks:')) {
    return {
      key: buildNotificationDedupKey('new-tasks', key.slice('new-tasks:'.length).split(',')),
      migrated: true
    }
  }
  if (key.length <= 96) return { key, migrated: false }
  return { key: `notification:v2:${sha256(key)}`, migrated: true }
}

function validIso(value: unknown): string | undefined {
  const text = String(value || '')
  return Number.isFinite(Date.parse(text)) ? new Date(Date.parse(text)).toISOString() : undefined
}

export function normalizeNotificationOutbox(value: any): NotificationOutbox {
  const sourcePending = Array.isArray(value?.pending) ? value.pending : []
  const sourceSentKeys = Array.isArray(value?.sentKeys) ? value.sentKeys : []
  let identityMigrations = 0
  let discardedInvalid = 0
  const sentKeys: string[] = []
  const sentSet = new Set<string>()
  for (const rawKey of sourceSentKeys) {
    const normalized = normalizeNotificationKey(rawKey)
    if (!normalized) {
      discardedInvalid += 1
      continue
    }
    if (normalized.migrated) identityMigrations += 1
    if (sentSet.has(normalized.key)) continue
    sentSet.add(normalized.key)
    sentKeys.push(normalized.key)
  }
  const pending: AssistantNotification[] = []
  const pendingSet = new Set<string>()
  for (const raw of sourcePending) {
    const normalized = normalizeNotificationKey(raw?.key)
    const createdAt = validIso(raw?.createdAt)
    const title = String(raw?.title || '').trim().slice(0, 160)
    if (!normalized || !createdAt || !title) {
      discardedInvalid += 1
      continue
    }
    if (normalized.migrated) identityMigrations += 1
    if (sentSet.has(normalized.key) || pendingSet.has(normalized.key)) continue
    pendingSet.add(normalized.key)
    pending.push({
      key: normalized.key,
      title,
      content: String(raw?.content || '').slice(0, 600),
      createdAt,
      attempts: Math.min(100_000, Math.max(0, Math.floor(Number(raw?.attempts) || 0))),
      lastError: String(raw?.lastError || '').slice(0, 300) || undefined,
      lastAttemptAt: validIso(raw?.lastAttemptAt),
      nextAttemptAt: validIso(raw?.nextAttemptAt)
    })
  }
  return {
    pending: pending.slice(-100),
    sentKeys: sentKeys.slice(-500),
    discardedPendingCount: Math.max(0, Number(value?.discardedPendingCount) || 0),
    lastDiscardedPendingAt: validIso(value?.lastDiscardedPendingAt),
    prunedSentKeyCount: Math.max(0, Number(value?.prunedSentKeyCount) || 0),
    identityMigrationCount: Math.max(0, Number(value?.identityMigrationCount) || 0) + identityMigrations,
    discardedInvalidCount: Math.max(0, Number(value?.discardedInvalidCount) || 0) + discardedInvalid
  }
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
  const normalized = normalizeNotificationOutbox({
    pending: [{ ...notification, attempts: 0 }],
    sentKeys: []
  }).pending[0]
  if (!normalized || outbox.sentKeys.includes(normalized.key) ||
      outbox.pending.some(item => item.key === normalized.key)) return false
  outbox.pending.push(normalized)
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
