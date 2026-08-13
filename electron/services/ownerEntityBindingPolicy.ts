import { resolveTrustedEntitySelection } from './trustedEntityDirectory.ts'

export function resolveOwnerEntityBinding(
  entities: readonly any[],
  input: { entityId?: unknown; directoryRevision?: unknown }
): any | null {
  const entityId = String(input.entityId || '').trim()
  if (!entityId) return null
  const selection = resolveTrustedEntitySelection(entities, {
    entityId,
    expectedRevision: String(input.directoryRevision || '')
  })
  if (selection.stale) {
    throw new Error('所选“我的图谱身份”已经变化、合并或不再可信，请重新选择')
  }
  if (selection.entity?.type !== 'person') {
    throw new Error('“我的图谱身份”必须选择一个已确认的人物实体')
  }
  return selection.entity
}
