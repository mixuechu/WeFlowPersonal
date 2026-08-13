export type TaskRunChange<T> = {
  taskId: string
  before?: Partial<T> | null
  after: T
}

export function collectCreatedTasksForRun<T extends { id?: string }>(
  current: Map<string, T>,
  changes: Array<TaskRunChange<T>>
): Map<string, T> {
  for (const change of changes) {
    const taskId = String(change.taskId || change.after?.id || '')
    if (!taskId) continue
    const createdInThisRun = current.has(taskId)
    const existedBeforeChange = Boolean(String(change.before?.id || ''))
    if (!createdInThisRun && existedBeforeChange) continue
    current.set(taskId, change.after)
  }
  return current
}

export function countCreatedTasks<T extends { id?: string }>(
  changes: Array<TaskRunChange<T>>
): number {
  return collectCreatedTasksForRun(new Map<string, T>(), changes).size
}
