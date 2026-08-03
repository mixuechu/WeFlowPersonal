import crypto from 'node:crypto'
import { isTrustedEntity } from './entityTrustPolicy.ts'

export interface TrustedEntityDirectoryOptions {
  query?: string
  type?: string
  offset?: number
  limit?: number
  expectedRevision?: string
}

const normalize = (value: unknown): string =>
  String(value || '').trim().toLocaleLowerCase('zh-CN')

const compact = (values: unknown, limit: number): string[] =>
  [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].slice(0, limit)

export function buildTrustedEntityDirectory(
  entities: readonly any[],
  options: TrustedEntityDirectoryOptions = {}
): {
  items: any[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  revision: string
  stale: boolean
  counts: Record<string, number>
} {
  const trusted = (Array.isArray(entities) ? entities : [])
    .filter(isTrustedEntity)
    .map(entity => ({
      id: String(entity?.id || '').trim(),
      type: String(entity?.type || 'unknown').trim() || 'unknown',
      canonicalName: String(entity?.canonicalName || '').trim(),
      aliases: compact(entity?.aliases, 8),
      accountIds: compact(entity?.accountIds, 8),
      externalIdentities: (Array.isArray(entity?.externalIdentities)
        ? entity.externalIdentities
        : []).slice(0, 8).map((identity: any) => ({
          platform: String(identity?.platform || '').trim(),
          accountId: String(identity?.accountId || '').trim(),
          displayName: String(identity?.displayName || '').trim()
        })),
      updatedAt: String(entity?.updatedAt || entity?.createdAt || '')
    }))
    .filter(entity => entity.id && entity.canonicalName)
  const nameCounts = new Map<string, number>()
  for (const entity of trusted) {
    const key = normalize(entity.canonicalName)
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1)
  }
  const directory = trusted.map(entity => ({
    ...entity,
    canonicalNameCollisionCount: nameCounts.get(normalize(entity.canonicalName)) || 1
  })).sort((left, right) =>
    left.canonicalName.localeCompare(right.canonicalName, 'zh-CN') ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  )
  const revision = crypto.createHash('sha256').update(JSON.stringify(directory.map(entity => [
    entity.id,
    entity.type,
    entity.canonicalName,
    entity.aliases,
    entity.accountIds,
    entity.externalIdentities,
    entity.updatedAt,
    entity.canonicalNameCollisionCount
  ]))).digest('hex')
  const query = normalize(options.query)
  const type = normalize(options.type)
  const filtered = directory.flatMap(entity => {
    if (type && type !== 'all' && normalize(entity.type) !== type) return []
    const terms = [
      entity.canonicalName,
      ...entity.aliases,
      ...entity.accountIds,
      ...entity.externalIdentities.flatMap((identity: any) => [
        identity.platform,
        identity.accountId,
        identity.displayName
      ]),
      entity.id
    ].map(normalize).filter(Boolean)
    if (!query) return [{ entity, score: 0 }]
    const score = terms.some(term => term === query) ? 0
      : terms.some(term => term.startsWith(query)) ? 1
        : terms.some(term => term.includes(query)) ? 2
          : Number.POSITIVE_INFINITY
    return Number.isFinite(score) ? [{ entity, score }] : []
  }).sort((left, right) =>
    left.score - right.score ||
    left.entity.canonicalName.localeCompare(right.entity.canonicalName, 'zh-CN') ||
    left.entity.id.localeCompare(right.entity.id)
  ).map(result => result.entity)
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 20)))
  const stale = Boolean(options.expectedRevision && options.expectedRevision !== revision)
  const items = stale ? [] : filtered.slice(offset, offset + limit)
  return {
    items,
    total: filtered.length,
    hasMore: !stale && offset + items.length < filtered.length,
    offset,
    limit,
    revision,
    stale,
    counts: directory.reduce((counts, entity) => {
      counts.all = (counts.all || 0) + 1
      counts[entity.type] = (counts[entity.type] || 0) + 1
      return counts
    }, {} as Record<string, number>)
  }
}
