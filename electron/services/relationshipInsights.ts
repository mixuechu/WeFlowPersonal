export type EntityInsight = {
  entityId: string
  strength: number
  strengthLabel: '强' | '中' | '弱'
  lastContactAt: number | null
  evidenceCount: number
  relationCount: number
  pendingRelationCount: number
  openTaskCount: number
  pendingCommitmentCount: number
  explanation: string[]
}

function normalizedIdentity(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function entityTaskNames(entity: any): string[] {
  return [...new Set([
    entity.canonicalName,
    ...(entity.aliases || []),
    ...(entity.accountIds || []),
    ...(entity.externalIdentities || []).flatMap((identity: any) => [
      identity.accountId,
      identity.displayName
    ])
  ].map(normalizedIdentity).filter(Boolean))]
}

export function taskRelatesToEntity(task: any, entity: any): boolean {
  const names = entityTaskNames(entity)
  if (!names.length) return false
  const exactFields = [
    task.owner,
    ...(task.collaborators || []),
    ...((task.evidence || []).map((item: any) => item.sender))
  ].map(normalizedIdentity).filter(Boolean)
  if (exactFields.some(value => names.includes(value))) return true
  const searchableNames = names.filter(name => name.length >= 2)
  if (!searchableNames.length) return false
  const text = normalizedIdentity([
    task.title,
    task.detail,
    task.project,
    ...(task.evidence || []).map((item: any) => item.excerpt)
  ].join(' '))
  return searchableNames.some(name => text.includes(name))
}

export function listEntityRelatedTasks(
  entity: any,
  tasks: any[],
  limit = 100
): { items: any[]; total: number; truncated: boolean } {
  const page = paginateEntityRelatedTasks(entity, tasks, { limit }, 'legacy-list')
  return {
    items: page.items,
    total: page.total,
    truncated: page.hasMore
  }
}

export function paginateEntityRelatedTasks(
  entity: any,
  tasks: any[],
  options: { limit?: number; offset?: number; revision?: string } = {},
  revision: string
): { items: any[]; total: number; hasMore: boolean; revision: string; stale: boolean } {
  const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
  if (offset > 0 && String(options.revision || '').trim() !== revision) {
    return { items: [], total: 0, hasMore: false, revision, stale: true }
  }
  const matches = tasks.filter(task => taskRelatesToEntity(task, entity))
    .sort((left, right) =>
      Number(['done', 'cancelled'].includes(left.status)) -
        Number(['done', 'cancelled'].includes(right.status)) ||
      String(right.updatedAt || right.createdAt || '')
        .localeCompare(String(left.updatedAt || left.createdAt || '')) ||
      String(left.id || '').localeCompare(String(right.id || '')))
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
  const items = matches.slice(offset, offset + safeLimit)
  return {
    items,
    total: matches.length,
    hasMore: offset + items.length < matches.length,
    revision,
    stale: false
  }
}

export function buildEntityInsights(input: {
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  tasks: any[]
  authoritativeEvidence?: Record<string, {
    evidenceTotal: number
    lastEvidenceAt: number | null
  }>
  now?: Date
}): Record<string, EntityInsight> {
  const now = (input.now || new Date()).getTime()
  const result: Record<string, EntityInsight> = {}
  const trustedIds = new Set(input.entities.filter(entity => entity.trustStatus === 'confirmed').map(entity => entity.id))
  for (const entity of input.entities.filter(entity => entity.trustStatus === 'confirmed')) {
    const relevantRelations = input.relations.filter(relation =>
      relation.status !== 'rejected' && trustedIds.has(relation.subjectId) && trustedIds.has(relation.objectId) &&
      (relation.subjectId === entity.id || relation.objectId === entity.id))
    const relations = relevantRelations.filter(relation => relation.status === 'confirmed')
    const candidateRelations = relevantRelations.filter(relation => relation.status === 'candidate')
    const claims = input.claims.filter(claim => claim.status !== 'rejected' && claim.subject_id === entity.id)
    const events = input.events.filter(event => event.status !== 'rejected' &&
      (event.participants || []).some((participant: any) => participant.entity_id === entity.id))
    const tasks = input.tasks.filter(task =>
      !['done', 'cancelled'].includes(task.status) && taskRelatesToEntity(task, entity))
    const evidence = [
      ...relevantRelations.flatMap(relation => relation.evidence || []),
      ...claims.flatMap(claim => claim.evidence || []),
      ...events.flatMap(event => event.evidence || []),
      ...tasks.flatMap(task => task.evidence || [])
    ]
    const uniqueEvidence = new Map(evidence.map((item: any) =>
      [String(item.messageId || item.message_id || `${item.timestamp}:${item.excerpt}`), item]))
    const timestamps = [...uniqueEvidence.values()].map((item: any) => Number(item.timestamp || 0)).filter(value => value > 0)
    const observedLastContactAt = timestamps.length ? Math.max(...timestamps) : null
    const authoritativeEvidence = input.authoritativeEvidence?.[entity.id]
    const lastContactCandidates = [
      observedLastContactAt,
      authoritativeEvidence?.lastEvidenceAt
    ].map(value => Number(value || 0)).filter(value => value > 0)
    const lastContactAt = lastContactCandidates.length ? Math.max(...lastContactCandidates) : null
    const evidenceCount = authoritativeEvidence
      ? Math.max(0, Number(authoritativeEvidence.evidenceTotal || 0))
      : uniqueEvidence.size
    const daysSinceContact = lastContactAt ? Math.max(0, (now - lastContactAt * 1000) / 86_400_000) : Infinity
    const recencyScore = daysSinceContact <= 7 ? 40 : daysSinceContact <= 30 ? 28 : daysSinceContact <= 90 ? 15 : 0
    const evidenceScore = Math.min(30, evidenceCount * 3)
    const relationScore = Math.min(20, relations.reduce((sum, relation) => sum + Number(relation.confidence || 0) * 10, 0))
    const taskScore = Math.min(10, tasks.length * 4)
    const strength = Math.round(Math.min(100, recencyScore + evidenceScore + relationScore + taskScore))
    const pendingCommitmentCount = events.filter(event =>
      event.event_type === 'commitment' && event.status === 'candidate').length
    const explanation = [
      lastContactAt ? `最近证据：${Math.floor(daysSinceContact)} 天前` : '尚无带时间的互动证据',
      `${evidenceCount} 条去重原文证据`,
      `${relations.length} 条已确认关系`,
      `${candidateRelations.length} 条关系待确认`,
      `${tasks.length} 项未完成关联任务`
    ]
    result[entity.id] = {
      entityId: entity.id,
      strength,
      strengthLabel: strength >= 70 ? '强' : strength >= 35 ? '中' : '弱',
      lastContactAt,
      evidenceCount,
      relationCount: relations.length,
      pendingRelationCount: candidateRelations.length,
      openTaskCount: tasks.length,
      pendingCommitmentCount,
      explanation
    }
  }
  return result
}
