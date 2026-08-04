import {
  boundedEvidencePayload,
  GRAPH_QUERY_EVIDENCE_LIMIT,
  MEMORY_CARD_EVIDENCE_LIMIT,
  PROJECT_EVIDENCE_LIMIT
} from '../../shared/evidencePayload.ts'

function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value)
}

function taskBelongsToProject(task: any, names: string[]): boolean {
  const project = normalize(task.project)
  if (project) return names.some(name => project === name)
  const text = normalize(`${task.title || ''} ${task.detail || ''}`)
  return names.some(name => name.length >= 3 && text.includes(name))
}

function eventBelongsToProject(event: any, entityId: string, names: string[]): boolean {
  if (entityId && (event.participants || []).some((participant: any) => participant.entity_id === entityId)) return true
  const text = normalize(`${event.title || ''} ${event.description || ''}`)
  return names.some(name => name.length >= 3 && text.includes(name))
}

export type ProjectInsightInput = {
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  tasks: any[]
  now?: Date
}

function buildProjectInsightsInternal(
  input: ProjectInsightInput,
  options: { includeDetails: boolean; projectId?: string }
): any[] {
  const now = input.now || new Date()
  const today = shanghaiDate(now)
  const trustedEntities = input.entities.filter(entity => entity.trustStatus === 'confirmed')
  const entityProjects = trustedEntities.filter(entity => entity.type === 'project')
  const entityProjectNames = new Set(entityProjects.flatMap(entity =>
    [entity.canonicalName, ...(entity.aliases || [])].map(normalize).filter(Boolean)))
  const derivedNameMap = new Map<string, string>()
  for (const task of input.tasks) {
    const displayName = String(task.project || '').trim()
    const normalizedName = normalize(displayName)
    if (normalizedName && !entityProjectNames.has(normalizedName) && !derivedNameMap.has(normalizedName)) {
      derivedNameMap.set(normalizedName, displayName)
    }
  }
  const derivedNames = [...derivedNameMap.values()]
  const projects = [
    ...entityProjects.map(entity => ({ entity, id: entity.id, name: entity.canonicalName, aliases: entity.aliases || [], inferred: false })),
    ...derivedNames.map(name => ({ entity: null, id: `derived:${normalize(name)}`, name, aliases: [], inferred: true }))
  ].filter(project => !options.projectId || project.id === options.projectId)
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
    const totalForProgress = tasks.filter(task => task.status !== 'cancelled').length
    const progress = totalForProgress ? Math.round(completedTasks.length / totalForProgress * 100) : 0
    const phase = totalForProgress && completedTasks.length === totalForProgress
      ? 'completed'
      : activeTasks.some(task => task.status === 'doing') ? 'active'
        : totalForProgress ? 'planned' : 'discovery'
    const pendingReviewTotal = candidateRelations.length + candidateClaims.length +
      pendingMilestones.length + pendingDecisions.length
    if (!options.includeDetails) {
      return {
        id: project.id,
        entityId: project.entity?.id || null,
        name: project.name,
        summary: project.entity?.summary || '',
        inferred: project.inferred,
        phase,
        progress,
        memberCount: members.length,
        activeTaskCount: activeTasks.length,
        riskCount: risks.length,
        pendingReviewTotal
      }
    }
    const evidence = [
      ...relations.flatMap(relation => relation.evidence || []),
      ...events.flatMap(event => event.evidence || []),
      ...tasks.flatMap(task => task.evidence || []),
      ...claims.flatMap(claim => claim.evidence || [])
    ]
    const uniqueEvidence = new Map(evidence.map((item: any) =>
      [String(item.messageId || item.message_id || `${item.timestamp}:${item.excerpt}`), item]))
    return {
      id: project.id,
      entityId: project.entity?.id || null,
      name: project.name,
      summary: project.entity?.summary || '',
      inferred: project.inferred,
      phase,
      progress,
      members,
      tasks: tasks.map(task => ({
        ...task,
        ...boundedEvidencePayload(task.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
      })),
      taskTotal: tasks.length,
      activeTaskCount: activeTasks.length,
      completedTaskCount: completedTasks.length,
      risks,
      milestones: milestones.map(event => ({
        ...event,
        ...boundedEvidencePayload(event.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
      })),
      decisions: decisions.map(event => ({
        ...event,
        ...boundedEvidencePayload(event.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
      })),
      claims: claims.map(claim => ({
        ...claim,
        ...boundedEvidencePayload(claim.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
      })),
      pendingReview: {
        relations: candidateRelations.map(relation => ({
          ...relation,
          ...boundedEvidencePayload(
            relation.evidence,
            GRAPH_QUERY_EVIDENCE_LIMIT,
            relation.evidenceTotal
          )
        })),
        claims: candidateClaims.map(claim => ({
          ...claim,
          ...boundedEvidencePayload(claim.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
        })),
        milestones: pendingMilestones.map(event => ({
          ...event,
          ...boundedEvidencePayload(event.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
        })),
        decisions: pendingDecisions.map(event => ({
          ...event,
          ...boundedEvidencePayload(event.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
        })),
        total: pendingReviewTotal
      },
      ...boundedEvidencePayload([...uniqueEvidence.values()], PROJECT_EVIDENCE_LIMIT)
    }
  }).sort((left, right) => {
    const severity = (project: any) => (project.risks
      ? project.risks.filter((risk: any) => risk.severity === 'high').length
      : Number(project.riskCount || 0)) * 10 + project.activeTaskCount
    return severity(right) - severity(left)
  })
}

export function buildProjectInsights(input: ProjectInsightInput): any[] {
  return buildProjectInsightsInternal(input, { includeDetails: true })
}

export function buildProjectDirectory(input: ProjectInsightInput): any[] {
  return buildProjectInsightsInternal(input, { includeDetails: false })
}

export function countProjectDirectory(input: ProjectInsightInput): number {
  const trustedProjects = input.entities.filter(entity =>
    entity.trustStatus === 'confirmed' && entity.type === 'project')
  const trustedNames = new Set(trustedProjects.flatMap(entity =>
    [entity.canonicalName, ...(entity.aliases || [])].map(normalize).filter(Boolean)))
  const derivedNames = new Set(input.tasks.map(task => String(task.project || '').trim()).filter(Boolean)
    .map(normalize).filter(name => !trustedNames.has(name)))
  return trustedProjects.length + derivedNames.size
}

export function paginateProjectDirectory(
  directory: any[],
  options: {
    query?: string
    phase?: string
    limit?: number
    offset?: number
    revision?: string
  },
  revision: string
): { items: any[]; total: number; hasMore: boolean; revision: string; stale: boolean } {
  const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
  if (offset > 0 && String(options.revision || '') !== revision) {
    return { items: [], total: 0, hasMore: false, revision, stale: true }
  }
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
  const phase = String(options.phase || '').trim()
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
  const matches = directory.filter(project =>
    (!query || `${project.name || ''}\u0000${project.summary || ''}`
      .toLocaleLowerCase('zh-CN').includes(query)) &&
    (!phase || project.phase === phase))
  const items = matches.slice(offset, offset + limit)
  return {
    items,
    total: matches.length,
    hasMore: offset + items.length < matches.length,
    revision,
    stale: false
  }
}

export function buildProjectInsight(input: ProjectInsightInput, projectId: string): any | null {
  return buildProjectInsightsInternal(input, {
    includeDetails: true,
    projectId: String(projectId || '').trim()
  })[0] || null
}

export function paginateProjectTasks(
  project: any,
  options: { limit?: number; offset?: number; revision?: string } = {},
  revision: string
): { items: any[]; total: number; hasMore: boolean; revision: string; stale: boolean } {
  const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
  if (offset > 0 && String(options.revision || '').trim() !== revision) {
    return { items: [], total: 0, hasMore: false, revision, stale: true }
  }
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
  const items = tasks.slice(offset, offset + limit)
  return {
    items,
    total: tasks.length,
    hasMore: offset + items.length < tasks.length,
    revision,
    stale: false
  }
}

export function paginateProjectRisks(
  project: any,
  options: { limit?: number; offset?: number; revision?: string } = {},
  revision: string
): { items: any[]; total: number; hasMore: boolean; revision: string; stale: boolean } {
  const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
  if (offset > 0 && String(options.revision || '').trim() !== revision) {
    return { items: [], total: 0, hasMore: false, revision, stale: true }
  }
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const risks = [...(Array.isArray(project?.risks) ? project.risks : [])].sort((left, right) =>
    Number(severityOrder[String(left.severity)] ?? 9) -
      Number(severityOrder[String(right.severity)] ?? 9) ||
    String(left.kind || '').localeCompare(String(right.kind || ''), 'zh-CN') ||
    String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN') ||
    String(left.taskId || '').localeCompare(String(right.taskId || '')))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
  const items = risks.slice(offset, offset + limit)
  return {
    items,
    total: risks.length,
    hasMore: offset + items.length < risks.length,
    revision,
    stale: false
  }
}
