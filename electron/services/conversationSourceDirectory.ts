import crypto from 'node:crypto'

export type ConversationSourceType = 'group' | 'private'
export type ConversationSourceEnabledFilter = 'all' | 'enabled' | 'disabled'

export interface ConversationSessionRecord {
  username?: string
  displayName?: string
  lastTimestamp?: number
}

export interface ConversationPolicyRecord {
  sessionId: string
  displayName: string
  sessionType: ConversationSourceType
  enabled: boolean
  updatedAt: string
}

export interface ConversationSourceItem {
  sessionId: string
  displayName: string
  type: ConversationSourceType
  enabled: boolean
  lastTimestamp: number
  policyUpdatedAt: string
  mutationToken: string
  selectionToken: string
  displayNameCollisionCount: number
  legacyNameFallbackSafe: boolean
}

export interface ConversationSourceDirectoryOptions {
  query?: string
  type?: ConversationSourceType | 'all'
  enabled?: ConversationSourceEnabledFilter
  offset?: number
  limit?: number
  expectedRevision?: string
  directoryScopeToken?: string
}

const digest = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

const normalizeQuery = (value: unknown): string => String(value || '').trim().toLocaleLowerCase('zh-CN')

export function isOfficialConversationId(sessionId: string): boolean {
  return sessionId.trim().toLocaleLowerCase().startsWith('gh_')
}

export function buildConversationSourceMutationToken(
  item: Pick<ConversationSourceItem,
    'sessionId' | 'displayName' | 'type' | 'enabled' | 'lastTimestamp' | 'policyUpdatedAt'>
): string {
  return digest([
    'conversation-source-v1',
    item.sessionId,
    item.displayName,
    item.type,
    item.enabled,
    item.lastTimestamp,
    item.policyUpdatedAt
  ])
}

export function buildConversationSourceSelectionToken(
  item: Pick<ConversationSourceItem,
    'sessionId' | 'displayName' | 'type' | 'enabled' | 'policyUpdatedAt'>
): string {
  return digest([
    'conversation-source-selection-v1',
    item.sessionId,
    item.displayName,
    item.type,
    item.enabled,
    item.policyUpdatedAt
  ])
}

export function buildConversationSourceDirectory(
  sessions: readonly ConversationSessionRecord[],
  policies: readonly ConversationPolicyRecord[],
  options: ConversationSourceDirectoryOptions = {}
): {
  items: ConversationSourceItem[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  revision: string
  stale: boolean
  directoryScopeToken: string
  directoryScopeStale: boolean
  counts: {
    total: number
    enabled: number
    disabled: number
    group: number
    private: number
    groupEnabled: number
    privateEnabled: number
  }
} {
  const policyMap = new Map(policies.map(policy => [policy.sessionId, policy]))
  const seen = new Set<string>()
  const normalized = sessions.flatMap(session => {
    const sessionId = String(session.username || '').trim()
    if (!sessionId || seen.has(sessionId) || isOfficialConversationId(sessionId)) return []
    seen.add(sessionId)
    const policy = policyMap.get(sessionId)
    const type: ConversationSourceType = sessionId.endsWith('@chatroom') ? 'group' : 'private'
    const base = {
      sessionId,
      displayName: String(session.displayName || policy?.displayName || sessionId).trim() || sessionId,
      type,
      enabled: policy?.enabled !== false,
      lastTimestamp: Number(session.lastTimestamp || 0),
      policyUpdatedAt: String(policy?.updatedAt || '')
    }
    return [{
      ...base,
      mutationToken: buildConversationSourceMutationToken(base),
      selectionToken: buildConversationSourceSelectionToken(base)
    }]
  })
  const displayNameCounts = new Map<string, number>()
  for (const item of normalized) {
    const key = normalizeQuery(item.displayName)
    displayNameCounts.set(key, (displayNameCounts.get(key) || 0) + 1)
  }
  const all: ConversationSourceItem[] = normalized.map(item => {
    const displayNameCollisionCount = displayNameCounts.get(normalizeQuery(item.displayName)) || 1
    return {
      ...item,
      displayNameCollisionCount,
      legacyNameFallbackSafe: displayNameCollisionCount === 1
    }
  }).sort((left, right) =>
    right.lastTimestamp - left.lastTimestamp ||
    left.sessionId.localeCompare(right.sessionId)
  )

  const revision = digest(all.map(item => [
    item.sessionId,
    item.displayName,
    item.type,
    item.enabled,
    item.lastTimestamp,
    item.policyUpdatedAt,
    item.displayNameCollisionCount
  ]))
  const query = normalizeQuery(options.query)
  const type = options.type === 'group' || options.type === 'private' ? options.type : 'all'
  const enabled = options.enabled === 'enabled' || options.enabled === 'disabled' ? options.enabled : 'all'
  const directoryScopeToken = digest([
    'conversation-source-directory-v1', query, type, enabled
  ])
  const filtered = all.filter(item => {
    if (type !== 'all' && item.type !== type) return false
    if (enabled === 'enabled' && !item.enabled) return false
    if (enabled === 'disabled' && item.enabled) return false
    if (query && !`${item.displayName}\n${item.sessionId}`.toLocaleLowerCase('zh-CN').includes(query)) return false
    return true
  })
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 50)))
  const directoryScopeStale = offset > 0 &&
    String(options.directoryScopeToken || '').trim() !== directoryScopeToken
  const stale = directoryScopeStale ||
    Boolean(options.expectedRevision && options.expectedRevision !== revision)
  const items = stale ? [] : filtered.slice(offset, offset + limit)

  return {
    items,
    total: filtered.length,
    hasMore: !stale && offset + items.length < filtered.length,
    offset,
    limit,
    revision,
    stale,
    directoryScopeToken,
    directoryScopeStale,
    counts: {
      total: all.length,
      enabled: all.filter(item => item.enabled).length,
      disabled: all.filter(item => !item.enabled).length,
      group: all.filter(item => item.type === 'group').length,
      private: all.filter(item => item.type === 'private').length,
      groupEnabled: all.filter(item => item.type === 'group' && item.enabled).length,
      privateEnabled: all.filter(item => item.type === 'private' && item.enabled).length
    }
  }
}

export function resolveConversationSourceSelection(
  items: readonly ConversationSourceItem[],
  input: { sessionId?: string; expectedSelectionToken?: string }
): {
  item: ConversationSourceItem | null
  stale: boolean
  reason: 'ok' | 'missing_session_id' | 'missing_selection_token' | 'unknown_session' | 'selection_changed'
} {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId) return { item: null, stale: true, reason: 'missing_session_id' }
  const expected = String(input.expectedSelectionToken || '').trim()
  if (!expected) return { item: null, stale: true, reason: 'missing_selection_token' }
  const item = items.find(candidate => candidate.sessionId === sessionId) || null
  if (!item) return { item: null, stale: true, reason: 'unknown_session' }
  if (item.selectionToken !== expected) {
    return { item: null, stale: true, reason: 'selection_changed' }
  }
  return { item, stale: false, reason: 'ok' }
}

export function assertConversationSourceMutation(
  item: ConversationSourceItem | undefined,
  mutationToken: unknown
): asserts item is ConversationSourceItem {
  if (!item || !mutationToken || item.mutationToken !== mutationToken) {
    throw new Error('信息来源目录已经变化，请刷新后重试')
  }
}
