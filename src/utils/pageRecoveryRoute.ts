export const PAGE_RECOVERY_ROUTE_KEY = 'weflow-page-recovery-route-v1'

export interface PageRecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const normalizePageRecoveryRoute = (value: unknown): string | null => {
  const route = String(value || '').trim()
  if (!route || route.length > 2048 || !route.startsWith('/') || route.startsWith('//')) return null
  if (/[\r\n\0]/.test(route)) return null
  return route
}

export const rememberPageRecoveryRoute = (
  storage: PageRecoveryStorage,
  route: unknown
): boolean => {
  const normalized = normalizePageRecoveryRoute(route)
  if (!normalized) return false
  storage.setItem(PAGE_RECOVERY_ROUTE_KEY, normalized)
  return true
}

export const consumePageRecoveryRoute = (storage: PageRecoveryStorage): string | null => {
  const route = normalizePageRecoveryRoute(storage.getItem(PAGE_RECOVERY_ROUTE_KEY))
  storage.removeItem(PAGE_RECOVERY_ROUTE_KEY)
  return route
}
