const PLACEHOLDER_PERSON_NAMES = new Set([
  '用户', '我', '本人', '自己', '对方', '群友', '某人', '未知', '未知用户', 'unknown', 'user'
])

export type PlaceholderEntityLike = {
  type?: unknown
  canonicalName?: unknown
  trustStatus?: unknown
  summary?: unknown
  summaryStatus?: unknown
  identityVersion?: unknown
  updatedAt?: unknown
}

export function isPlaceholderPersonEntity(entity: PlaceholderEntityLike): boolean {
  return String(entity?.type || '') === 'person' &&
    PLACEHOLDER_PERSON_NAMES.has(String(entity?.canonicalName || '').trim().toLowerCase())
}

export function quarantinePlaceholderPersonEntities<T extends PlaceholderEntityLike>(
  entities: T[],
  updatedAt: string
): { entities: T[]; quarantined: number; changed: number } {
  let quarantined = 0
  let changed = 0
  const next = entities.map(entity => {
    if (!isPlaceholderPersonEntity(entity)) return entity
    quarantined += 1
    if (entity.trustStatus === 'rejected') return entity
    const summaryStatus = String(entity.summary || '') ? 'legacy_unverified' : 'empty'
    if (entity.trustStatus === 'legacy_unverified' && entity.summaryStatus === summaryStatus) {
      return entity
    }
    changed += 1
    return {
      ...entity,
      trustStatus: 'legacy_unverified',
      summaryStatus,
      identityVersion: Math.max(1, Number(entity.identityVersion || 1)) + 1,
      updatedAt
    } as T
  })
  return { entities: next, quarantined, changed }
}
