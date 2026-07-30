function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
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

export function planExtractedEntityResolution(
  item: any,
  existingEntities: any[]
): {
  existing: any | null
  verifiedAccountIds: string[]
  rejectedAccountIds: string[]
  sameNameCandidates: any[]
  resolution: 'verified_account' | 'non_person_exact_name' | 'create_candidate'
} {
  const type = String(item?.type || 'person')
  const names = new Set([
    item?.canonicalName,
    ...(Array.isArray(item?.aliases) ? item.aliases : [])
  ].map(normalize).filter(value => value.length >= 2))
  const requestedAccounts = [...new Set(
    (Array.isArray(item?.accountIds) ? item.accountIds : []).map(String).filter(Boolean)
  )]
  const messages = Array.isArray(item?.__evidenceMessages) ? item.__evidenceMessages : []
  const verifiedAccountIds = requestedAccounts.filter(accountId => messages.some(message => {
    if (type === 'group' && message?.isGroup && String(message.sessionId || '') === accountId) {
      return names.has(normalize(message.sessionName))
    }
    const identity = message?.senderIdentity
    return String(identity?.wxid || '') === accountId &&
      identityNames(identity).some(name => names.has(name))
  }))
  const rejectedAccountIds = requestedAccounts.filter(accountId => !verifiedAccountIds.includes(accountId))
  const accountMatches = existingEntities.filter(entity =>
    entity.type === type && (entity.accountIds || []).some((id: string) => verifiedAccountIds.includes(id)))
  if (verifiedAccountIds.length && accountMatches.length === 1) {
    return {
      existing: accountMatches[0],
      verifiedAccountIds,
      rejectedAccountIds,
      sameNameCandidates: [],
      resolution: 'verified_account'
    }
  }
  const canonical = normalize(item?.canonicalName)
  const sameNameCandidates = existingEntities.filter(entity =>
    entity.type === type && normalize(entity.canonicalName) === canonical)
  if (type !== 'person' && sameNameCandidates.length === 1 && Number(item?.confidence || 0) >= 0.9) {
    return {
      existing: sameNameCandidates[0],
      verifiedAccountIds,
      rejectedAccountIds,
      sameNameCandidates,
      resolution: 'non_person_exact_name'
    }
  }
  return {
    existing: null,
    verifiedAccountIds,
    rejectedAccountIds,
    sameNameCandidates,
    resolution: 'create_candidate'
  }
}
