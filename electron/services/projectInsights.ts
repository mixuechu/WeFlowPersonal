function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function taskBelongsToProject(task: any, names: string[]): boolean {
  const project = normalize(task.project)
  if (project && names.some(name => project === name || project.includes(name) || name.includes(project))) return true
  const text = normalize(`${task.title || ''} ${task.detail || ''}`)
  return names.some(name => name.length >= 3 && text.includes(name))
}

function eventBelongsToProject(event: any, entityId: string, names: string[]): boolean {
  if (entityId && (event.participants || []).some((participant: any) => participant.entity_id === entityId)) return true
  const text = normalize(`${event.title || ''} ${event.description || ''}`)
  return names.some(name => name.length >= 3 && text.includes(name))
}

export function buildProjectInsights(input: {
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  tasks: any[]
  now?: Date
}): any[] {
  const now = input.now || new Date()
  const today = now.toISOString().slice(0, 10)
  const trustedEntities = input.entities.filter(entity => entity.trustStatus === 'confirmed')
  const entityProjects = trustedEntities.filter(entity => entity.type === 'project')
  const derivedNames = [...new Set(input.tasks.map(task => String(task.project || '').trim()).filter(Boolean))]
    .filter(name => !entityProjects.some(entity => [entity.canonicalName, ...(entity.aliases || [])]
      .some(value => normalize(value) === normalize(name))))
  const projects = [
    ...entityProjects.map(entity => ({ entity, id: entity.id, name: entity.canonicalName, aliases: entity.aliases || [], inferred: false })),
    ...derivedNames.map(name => ({ entity: null, id: `derived:${normalize(name)}`, name, aliases: [], inferred: true }))
  ]
  const taskById = new Map(input.tasks.map(task => [task.id, task]))
  return projects.map(project => {
    const names = [project.name, ...project.aliases].map(normalize).filter(Boolean)
    const tasks = input.tasks.filter(task => taskBelongsToProject(task, names))
    const activeTasks = tasks.filter(task => !['done', 'cancelled'].includes(task.status))
    const completedTasks = tasks.filter(task => task.status === 'done')
    const relevantEvents = input.events.filter(event => !['rejected', 'cancelled'].includes(event.status) &&
      eventBelongsToProject(event, project.entity?.id || '', names))
    const events = relevantEvents.filter(event => event.status === 'confirmed')
    const candidateEvents = relevantEvents.filter(event => event.status === 'candidate')
    const relevantRelations = project.entity ? input.relations.filter(relation =>
      relation.status !== 'rejected' && (relation.subjectId === project.id || relation.objectId === project.id)) : []
    const relations = relevantRelations.filter(relation => relation.status === 'confirmed')
    const candidateRelations = relevantRelations.filter(relation => relation.status === 'candidate')
    const memberIds = [...new Set(relations.map(relation =>
      relation.subjectId === project.id ? relation.objectId : relation.subjectId))]
    const members = memberIds.map(id => trustedEntities.find(entity => entity.id === id))
      .filter(entity => entity?.type === 'person')
      .map(entity => ({ id: entity.id, name: entity.canonicalName }))
    const relevantClaims = project.entity ? input.claims.filter(claim =>
      claim.status !== 'rejected' && claim.subject_id === project.id) : []
    const claims = relevantClaims.filter(claim => claim.status === 'confirmed')
    const candidateClaims = relevantClaims.filter(claim => claim.status === 'candidate')
    const risks = activeTasks.flatMap(task => {
      const taskRisks: any[] = []
      if (task.due && String(task.due).slice(0, 10) < today) {
        taskRisks.push({ kind: 'overdue', severity: 'high', taskId: task.id, title: task.title, detail: `截止 ${task.due}` })
      }
      if (task.status === 'waiting' || task.taskKind === 'waiting') {
        taskRisks.push({ kind: 'waiting', severity: 'medium', taskId: task.id, title: task.title, detail: '正在等待他人或外部输入' })
      }
      const blockers = (task.dependsOnIds || []).map((id: string) => taskById.get(id))
        .filter((dependency: any) => dependency && !['done', 'cancelled'].includes(dependency.status))
      if (blockers.length) {
        taskRisks.push({ kind: 'blocked', severity: 'high', taskId: task.id, title: task.title, detail: `被 ${blockers.map((item: any) => item.title).join('、')} 阻塞` })
      }
      if (task.priority === 'high' && !task.due) {
        taskRisks.push({ kind: 'unscheduled_high_priority', severity: 'medium', taskId: task.id, title: task.title, detail: '高优先级但没有截止时间' })
      }
      return taskRisks
    })
    const milestones = events.filter(event => ['delivery', 'meeting', 'organization_change'].includes(event.event_type))
    const decisions = events.filter(event => event.event_type === 'decision')
    const pendingMilestones = candidateEvents.filter(event =>
      ['delivery', 'meeting', 'organization_change'].includes(event.event_type))
    const pendingDecisions = candidateEvents.filter(event => event.event_type === 'decision')
    const evidence = [
      ...relations.flatMap(relation => relation.evidence || []),
      ...events.flatMap(event => event.evidence || []),
      ...tasks.flatMap(task => task.evidence || []),
      ...claims.flatMap(claim => claim.evidence || [])
    ]
    const uniqueEvidence = new Map(evidence.map((item: any) =>
      [String(item.messageId || item.message_id || `${item.timestamp}:${item.excerpt}`), item]))
    const totalForProgress = tasks.filter(task => task.status !== 'cancelled').length
    const progress = totalForProgress ? Math.round(completedTasks.length / totalForProgress * 100) : 0
    const phase = totalForProgress && completedTasks.length === totalForProgress
      ? 'completed'
      : activeTasks.some(task => task.status === 'doing') ? 'active'
        : totalForProgress ? 'planned' : 'discovery'
    return {
      id: project.id,
      entityId: project.entity?.id || null,
      name: project.name,
      summary: project.entity?.summary || '',
      inferred: project.inferred,
      phase,
      progress,
      members,
      tasks,
      activeTaskCount: activeTasks.length,
      completedTaskCount: completedTasks.length,
      risks,
      milestones,
      decisions,
      claims,
      pendingReview: {
        relations: candidateRelations,
        claims: candidateClaims,
        milestones: pendingMilestones,
        decisions: pendingDecisions,
        total: candidateRelations.length + candidateClaims.length + pendingMilestones.length + pendingDecisions.length
      },
      evidence: [...uniqueEvidence.values()].sort((left: any, right: any) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
    }
  }).sort((left, right) => {
    const severity = (project: any) => project.risks.filter((risk: any) => risk.severity === 'high').length * 10 + project.activeTaskCount
    return severity(right) - severity(left)
  })
}
