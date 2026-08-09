function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

export type ExtractedEntityResolutionIndex = {
  byTypeAndAccount: Map<string, any[]>
  byTypeAndCanonicalName: Map<string, any[]>
  accountMemberIds: Map<string, Set<string>>
  canonicalNameMemberIds: Map<string, Set<string>>
}

const resolutionKey = (type: unknown, value: unknown): string =>
  `${String(type || 'person')}\u0000${String(value || '')}`

export function addEntityToResolutionIndex(
  index: ExtractedEntityResolutionIndex,
  entity: any
): void {
  const append = (
    map: Map<string, any[]>,
    members: Map<string, Set<string>>,
    key: string
  ): void => {
    const ids = members.get(key) || new Set<string>()
    if (ids.has(entity.id)) return
    ids.add(entity.id)
    members.set(key, ids)
    map.set(key, [...(map.get(key) || []), entity])
  }
  for (const accountId of entity?.accountIds || []) {
    append(
      index.byTypeAndAccount,
      index.accountMemberIds,
      resolutionKey(entity?.type, accountId)
    )
  }
  append(
    index.byTypeAndCanonicalName,
    index.canonicalNameMemberIds,
    resolutionKey(entity?.type, normalize(entity?.canonicalName))
  )
}

export function buildExtractedEntityResolutionIndex(
  entities: any[]
): ExtractedEntityResolutionIndex {
  const index: ExtractedEntityResolutionIndex = {
    byTypeAndAccount: new Map(),
    byTypeAndCanonicalName: new Map(),
    accountMemberIds: new Map(),
    canonicalNameMemberIds: new Map()
  }
  for (const entity of entities) addEntityToResolutionIndex(index, entity)
  return index
}

function identityNames(identity: any): string[] {
  return [
    identity?.displayName,
    identity?.contactRemark,
    identity?.wechatNickname,
    identity?.groupNickname,
    identity?.alias
  ].map(normalize).filter(value => value.length >= 2)
}

function requestedAliases(item: any): string[] {
  return [...new Set((Array.isArray(item?.aliases) ? item.aliases : [])
    .map((value: unknown) => String(value || '').trim()).filter(Boolean))]
}

export function planExtractedEntityResolution(
  item: any,
  existingEntities: any[] | ExtractedEntityResolutionIndex
): {
  existing: any | null
  verifiedAccountIds: string[]
  rejectedAccountIds: string[]
  verifiedAliases: string[]
  candidateAliases: string[]
  sameNameCandidates: any[]
  resolution: 'verified_account' | 'non_person_exact_name' | 'create_candidate'
} {
  const type = String(item?.type || 'person')
  const requestedAccounts = [...new Set(
    (Array.isArray(item?.accountIds) ? item.accountIds : []).map(String).filter(Boolean)
  )]
  const messages = Array.isArray(item?.__evidenceMessages) ? item.__evidenceMessages : []
  const aliases = requestedAliases(item)
  const canonicalName = normalize(item?.canonicalName)
  const verifiedAliases = aliases.filter(alias => {
    const normalizedAlias = normalize(alias)
    return messages.some(message => {
      if (type === 'group' && message?.isGroup && normalize(message?.sessionName) === canonicalName) {
        return normalize(message?.sessionName) === normalizedAlias
      }
      const names = identityNames(message?.senderIdentity)
      return names.includes(canonicalName) && names.includes(normalizedAlias)
    })
  })
  const candidateAliases = aliases.filter(alias => !verifiedAliases.includes(alias))
  const verifiedAccountIds = requestedAccounts.filter(accountId => messages.some(message => {
    if (type === 'group' && message?.isGroup && String(message.sessionId || '') === accountId) {
      return canonicalName === normalize(message.sessionName)
    }
    const identity = message?.senderIdentity
    return String(identity?.wxid || '') === accountId &&
      identityNames(identity).includes(canonicalName)
  }))
  const rejectedAccountIds = requestedAccounts.filter(accountId => !verifiedAccountIds.includes(accountId))
  const accountMatches = Array.isArray(existingEntities)
    ? existingEntities.filter(entity =>
      entity.type === type && (entity.accountIds || []).some((id: string) => verifiedAccountIds.includes(id)))
    : [...new Map(verifiedAccountIds.flatMap(accountId =>
      (existingEntities.byTypeAndAccount.get(resolutionKey(type, accountId)) || [])
        .map(entity => [String(entity.id), entity] as const))).values()]
  if (verifiedAccountIds.length && accountMatches.length === 1) {
    return {
      existing: accountMatches[0],
      verifiedAccountIds,
      rejectedAccountIds,
      verifiedAliases,
      candidateAliases,
      sameNameCandidates: [],
      resolution: 'verified_account'
    }
  }
  const canonical = normalize(item?.canonicalName)
  const sameNameCandidates = Array.isArray(existingEntities)
    ? existingEntities.filter(entity => entity.type === type && normalize(entity.canonicalName) === canonical)
    : [...(existingEntities.byTypeAndCanonicalName.get(resolutionKey(type, canonical)) || [])]
  if (type !== 'person' && sameNameCandidates.length === 1 && Number(item?.confidence || 0) >= 0.9) {
    return {
      existing: sameNameCandidates[0],
      verifiedAccountIds,
      rejectedAccountIds,
      verifiedAliases,
      candidateAliases,
      sameNameCandidates,
      resolution: 'non_person_exact_name'
    }
  }
  return {
    existing: null,
    verifiedAccountIds,
    rejectedAccountIds,
    verifiedAliases,
    candidateAliases,
    sameNameCandidates,
    resolution: 'create_candidate'
  }
}
