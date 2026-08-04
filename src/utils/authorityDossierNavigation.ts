export type StructuredMemoryKind = 'claim' | 'event' | 'relation'

export type AuthorityReturnTarget = {
  kind: StructuredMemoryKind
  sourceId: string
  searchRevision: string
}

export function buildAuthorityReturnTarget(dossier: any): AuthorityReturnTarget | null {
  const kind = String(dossier?.kind || '') as StructuredMemoryKind
  const sourceId = String(dossier?.sourceId || '').trim()
  const searchRevision = String(dossier?.revision || '').trim()
  if (dossier?.status !== 'ready' ||
    !['claim', 'event', 'relation'].includes(kind) ||
    !sourceId ||
    !searchRevision) return null
  return { kind, sourceId, searchRevision }
}

export function authorityReturnLabel(target: AuthorityReturnTarget | null): string {
  if (!target) return '完成'
  return `返回${target.kind === 'claim' ? '事实' : target.kind === 'event' ? '事件' : '关系'}档案`
}
