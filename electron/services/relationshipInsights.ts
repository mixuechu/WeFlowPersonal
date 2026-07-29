export type EntityInsight = {
  entityId: string
  strength: number
  strengthLabel: '强' | '中' | '弱'
  lastContactAt: number | null
  evidenceCount: number
  relationCount: number
  openTaskCount: number
  pendingCommitmentCount: number
  explanation: string[]
}

export function buildEntityInsights(input: {
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  tasks: any[]
  now?: Date
}): Record<string, EntityInsight> {
  const now = (input.now || new Date()).getTime()
  const result: Record<string, EntityInsight> = {}
  for (const entity of input.entities) {
    const names = [entity.canonicalName, ...(entity.aliases || []), ...(entity.accountIds || [])]
      .map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean)
    const relations = input.relations.filter(relation =>
      relation.status !== 'rejected' && (relation.subjectId === entity.id || relation.objectId === entity.id))
    const claims = input.claims.filter(claim => claim.status !== 'rejected' && claim.subject_id === entity.id)
    const events = input.events.filter(event => event.status !== 'rejected' &&
      (event.participants || []).some((participant: any) => participant.entity_id === entity.id))
    const tasks = input.tasks.filter(task => !['done', 'cancelled'].includes(task.status) && [
      task.owner,
      ...(task.collaborators || []),
      task.project,
      task.title,
      task.detail
    ].some(value => names.some(name => String(value || '').toLowerCase().includes(name))))
    const evidence = [
      ...relations.flatMap(relation => relation.evidence || []),
      ...claims.flatMap(claim => claim.evidence || []),
      ...events.flatMap(event => event.evidence || []),
      ...tasks.flatMap(task => task.evidence || [])
    ]
    const uniqueEvidence = new Map(evidence.map((item: any) =>
      [String(item.messageId || item.message_id || `${item.timestamp}:${item.excerpt}`), item]))
    const timestamps = [...uniqueEvidence.values()].map((item: any) => Number(item.timestamp || 0)).filter(value => value > 0)
    const lastContactAt = timestamps.length ? Math.max(...timestamps) : null
    const daysSinceContact = lastContactAt ? Math.max(0, (now - lastContactAt * 1000) / 86_400_000) : Infinity
    const recencyScore = daysSinceContact <= 7 ? 40 : daysSinceContact <= 30 ? 28 : daysSinceContact <= 90 ? 15 : 0
    const evidenceScore = Math.min(30, uniqueEvidence.size * 3)
    const relationScore = Math.min(20, relations.reduce((sum, relation) => sum + Number(relation.confidence || 0) * 10, 0))
    const taskScore = Math.min(10, tasks.length * 4)
    const strength = Math.round(Math.min(100, recencyScore + evidenceScore + relationScore + taskScore))
    const pendingCommitmentCount = events.filter(event =>
      event.event_type === 'commitment' && event.status !== 'confirmed').length
    const explanation = [
      lastContactAt ? `最近证据：${Math.floor(daysSinceContact)} 天前` : '尚无带时间的互动证据',
      `${uniqueEvidence.size} 条去重原文证据`,
      `${relations.length} 条有效关系`,
      `${tasks.length} 项未完成关联任务`
    ]
    result[entity.id] = {
      entityId: entity.id,
      strength,
      strengthLabel: strength >= 70 ? '强' : strength >= 35 ? '中' : '弱',
      lastContactAt,
      evidenceCount: uniqueEvidence.size,
      relationCount: relations.length,
      openTaskCount: tasks.length,
      pendingCommitmentCount,
      explanation
    }
  }
  return result
}
