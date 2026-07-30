const compactStrings = (values: unknown, limit: number, maxLength: number): string[] =>
  [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, limit)

export function toGraphEntityDirectoryEntry(entity: any): any {
  return {
    id: String(entity?.id || ''),
    type: String(entity?.type || ''),
    canonicalName: String(entity?.canonicalName || '').slice(0, 200),
    aliases: compactStrings(entity?.aliases, 32, 200),
    accountIds: compactStrings(entity?.accountIds, 16, 200),
    externalIdentities: (Array.isArray(entity?.externalIdentities) ? entity.externalIdentities : [])
      .slice(0, 16)
      .map((identity: any) => ({
        platform: String(identity?.platform || '').slice(0, 50),
        accountId: String(identity?.accountId || '').slice(0, 320),
        displayName: String(identity?.displayName || '').slice(0, 200),
        confidence: Math.max(0, Math.min(1, Number(identity?.confidence || 0)))
      })),
    summaryStatus: String(entity?.summaryStatus || 'empty'),
    trustStatus: String(entity?.trustStatus || 'legacy_unverified'),
    identityVersion: Math.max(1, Math.floor(Number(entity?.identityVersion) || 1)),
    updatedAt: String(entity?.updatedAt || entity?.createdAt || '')
  }
}

export function toGraphViewportNode(entity: any): any {
  return {
    id: String(entity?.id || ''),
    type: String(entity?.type || ''),
    canonicalName: String(entity?.canonicalName || '').slice(0, 200),
    trustStatus: String(entity?.trustStatus || 'legacy_unverified')
  }
}

export function toGraphViewportEdge(relation: any): any {
  return {
    id: String(relation?.id || ''),
    subjectId: String(relation?.subjectId || ''),
    predicate: String(relation?.predicate || '').slice(0, 100),
    objectId: String(relation?.objectId || ''),
    status: String(relation?.status || 'candidate'),
    confidence: Math.max(0, Math.min(1, Number(relation?.confidence || 0)))
  }
}

export function buildGraphDashboardPayload(entities: any[]): {
  entities: any[]
  relations: never[]
  reviewQueue: never[]
} {
  return {
    entities: (Array.isArray(entities) ? entities : []).map(toGraphEntityDirectoryEntry),
    relations: [],
    reviewQueue: []
  }
}
