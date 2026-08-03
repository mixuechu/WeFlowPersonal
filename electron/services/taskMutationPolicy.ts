import { createHash } from 'crypto'

const canonicalEvidence = (task: any): string[] => (Array.isArray(task?.evidence) ? task.evidence : [])
  .map((item: any) => [
    String(item?.sourceId || '').trim(),
    String(item?.sessionId || '').trim(),
    String(item?.messageId || '').trim(),
    Number(item?.timestamp || 0),
    String(item?.sender || '').trim(),
    createHash('sha256').update(String(item?.excerpt || '')).digest('hex')
  ].join('\u001f'))
  .sort()

export const buildTaskMutationIdentity = (task: any): any => ({
  id: String(task?.id || '').trim(),
  title: String(task?.title || ''),
  detail: String(task?.detail || ''),
  owner: String(task?.owner || ''),
  collaborators: [...(Array.isArray(task?.collaborators) ? task.collaborators : [])].map(String).sort(),
  project: String(task?.project || ''),
  dependsOnIds: [...(Array.isArray(task?.dependsOnIds) ? task.dependsOnIds : [])].map(String).sort(),
  taskKind: String(task?.taskKind || ''),
  due: String(task?.due || ''),
  priority: String(task?.priority || ''),
  status: String(task?.status || ''),
  classification: String(task?.classification || ''),
  updatedAt: String(task?.updatedAt || task?.createdAt || ''),
  evidence: canonicalEvidence(task)
})

export const buildTaskMutationToken = (task: any): string =>
  createHash('sha256').update(JSON.stringify(buildTaskMutationIdentity(task))).digest('hex')

export const assertTaskMutationToken = (task: any, token: unknown): void => {
  const provided = String(token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided) || provided !== buildTaskMutationToken(task)) {
    throw new Error('这条待办在你查看后已经被更新，请刷新后再操作')
  }
}

export const assertTaskMutationBatch = (
  tasks: any[],
  updates: Array<{ id?: string; mutationToken?: string }>
): void => {
  const byId = new Map((Array.isArray(tasks) ? tasks : []).map(task => [String(task?.id || ''), task]))
  const seen = new Set<string>()
  for (const update of Array.isArray(updates) ? updates : []) {
    const id = String(update?.id || '').trim()
    if (!id || seen.has(id)) throw new Error('批量待办操作包含无效或重复项目')
    seen.add(id)
    const task = byId.get(id)
    if (!task) throw new Error('待办已不存在，请刷新后再操作')
    assertTaskMutationToken(task, update.mutationToken)
  }
}

export const classifyTaskMutationRecovery = (
  currentTasks: any[],
  beforeTokens: Record<string, string>,
  afterTokens: Record<string, string>
): 'apply' | 'abandon' | 'conflict' => {
  const current = new Map((Array.isArray(currentTasks) ? currentTasks : [])
    .map(task => [String(task?.id || ''), buildTaskMutationToken(task)]))
  const ids = [...new Set([...Object.keys(beforeTokens || {}), ...Object.keys(afterTokens || {})])]
  if (!ids.length) return 'conflict'
  if (ids.every(id => current.get(id) === String(afterTokens?.[id] || ''))) return 'apply'
  if (ids.every(id => current.get(id) === String(beforeTokens?.[id] || ''))) return 'abandon'
  return 'conflict'
}
