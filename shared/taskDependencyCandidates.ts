export type TaskDependencyCandidateOptions = {
  query?: string
  selectedIds?: string[]
  excludeId?: string
  limit?: number
  revision?: string
}

export function buildTaskDependencyCandidates(
  tasks: any[],
  options: TaskDependencyCandidateOptions,
  revision: string
): {
  items: any[]
  total: number
  revision: string
  stale: boolean
} {
  if (options.revision && options.revision !== revision) {
    return { items: [], total: 0, revision, stale: true }
  }
  const excludeId = String(options.excludeId || '')
  const selectedIds = [...new Set((options.selectedIds || []).map(String).filter(Boolean))]
  const selected = new Set(selectedIds)
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
  const eligible = tasks.filter(task =>
    task.id !== excludeId &&
    (task.classification === 'mine' || selected.has(String(task.id))) &&
    (task.status !== 'cancelled' || selected.has(String(task.id))))
  const matches = eligible.filter(task => selected.has(String(task.id)) || !query ||
    `${task.title || ''}\u0000${task.detail || ''}\u0000${task.project || ''}\u0000${task.owner || ''}`
      .toLocaleLowerCase('zh-CN').includes(query))
    .sort((left, right) =>
      Number(!selected.has(String(left.id))) - Number(!selected.has(String(right.id))) ||
      Number(['done', 'cancelled'].includes(left.status)) -
        Number(['done', 'cancelled'].includes(right.status)) ||
      ({ high: 0, medium: 1, low: 2 }[left.priority as 'high' | 'medium' | 'low'] ?? 3) -
        ({ high: 0, medium: 1, low: 2 }[right.priority as 'high' | 'medium' | 'low'] ?? 3) ||
      String(right.updatedAt || right.createdAt || '')
        .localeCompare(String(left.updatedAt || left.createdAt || '')))
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 20)))
  const selectedItems = matches.filter(task => selected.has(String(task.id)))
  const ordinaryItems = matches.filter(task => !selected.has(String(task.id))).slice(0, limit)
  return {
    items: [...selectedItems, ...ordinaryItems].map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      project: task.project || '',
      due: task.due || ''
    })),
    total: matches.length,
    revision,
    stale: false
  }
}
