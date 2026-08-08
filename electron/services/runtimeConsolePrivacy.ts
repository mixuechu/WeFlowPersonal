export type AvatarCacheConsoleAction = 'downloaded' | 'evicted' | 'cleared'

export const formatAvatarCacheConsoleEvent = (action: AvatarCacheConsoleAction): string => {
  if (action === 'downloaded') return '[AvatarFileCache] Cached one avatar'
  if (action === 'evicted') return '[AvatarFileCache] Evicted one cached avatar'
  return '[AvatarFileCache] Cache cleared'
}

export const formatSystemNotificationShown = (notificationId: unknown): string => {
  const id = typeof notificationId === 'number' && Number.isSafeInteger(notificationId) && notificationId > 0
    ? notificationId
    : 0
  return `[SystemNotification] Shown notification ${id}`
}

export const formatSystemNotificationNavigation = (payload: unknown): string => {
  if (typeof payload === 'string' && payload.trim()) {
    return '[NotificationWindow] System notification clicked (session target)'
  }
  if (payload && typeof payload === 'object') {
    return '[NotificationWindow] System notification clicked (structured target)'
  }
  return '[NotificationWindow] System notification clicked (no target)'
}

export const formatNotificationRendererLoad = (development: boolean): string =>
  `[NotificationWindow] Loading ${development ? 'development' : 'packaged'} renderer`
