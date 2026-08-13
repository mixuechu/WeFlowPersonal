export function boundEntityIdentityPresentation(entity: any, previewLimit = 8): {
  entity: any
  summary: {
    aliases: number
    wechat: number
    external: number
    previewLimit: number
  }
} {
  const aliases = Array.isArray(entity?.aliases) ? entity.aliases : []
  const accountIds = Array.isArray(entity?.accountIds) ? entity.accountIds : []
  const externalIdentities = Array.isArray(entity?.externalIdentities)
    ? entity.externalIdentities.filter((identity: any) =>
        String(identity?.platform || '').trim().toLowerCase() !== 'wechat')
    : []
  const limit = Math.max(1, Math.min(20, Math.floor(Number(previewLimit) || 8)))
  const { evidenceMessageIds: _evidenceMessageIds, ...safeEntity } = entity || {}
  return {
    entity: {
      ...safeEntity,
      aliases: aliases.slice(0, limit),
      accountIds: accountIds.slice(0, limit),
      externalIdentities: externalIdentities.slice(0, limit)
    },
    summary: {
      aliases: aliases.length,
      wechat: accountIds.length,
      external: externalIdentities.length,
      previewLimit: limit
    }
  }
}
