import { compactGraphReviewWorkset } from './graphReviewStorage.ts'

export const TASK_STATE_STORAGE_VERSION = 'task-state-storage-v2'

export function taskIsClosed(task: any): boolean {
  return task?.status === 'done' || task?.status === 'cancelled'
}

export function compactTaskForEncryptedState(task: any): any {
  if (!taskIsClosed(task)) return task
  const {
    evidence: _evidence,
    sourceMessageIds: _sourceMessageIds,
    ...directoryTask
  } = task || {}
  return directoryTask
}

export function buildEncryptedAssistantState(state: any): any {
  const compactedReviews = compactGraphReviewWorkset(state?.graph?.reviewQueue)
  return {
    ...state,
    tasks: Array.isArray(state?.tasks)
      ? state.tasks.map(compactTaskForEncryptedState)
      : [],
    graph: {
      ...(state?.graph || {}),
      reviewQueue: compactedReviews.pending
    }
  }
}

export function getTaskStateStorageStats(tasks: any[]): any {
  const list = Array.isArray(tasks) ? tasks : []
  const closed = list.filter(taskIsClosed)
  return {
    version: TASK_STATE_STORAGE_VERSION,
    policy: 'active_full_closed_structure_only_sqlcipher_evidence',
    tasks: list.length,
    activeTasks: list.length - closed.length,
    closedTasks: closed.length,
    activeEvidenceRows: list.filter(task => !taskIsClosed(task))
      .reduce((total, task) => total + Number(task?.evidence?.length || 0), 0),
    closedEvidenceRowsOmittedOnWrite: closed
      .reduce((total, task) => total + Number(task?.evidence?.length || 0), 0),
    closedMessageKeysOmittedOnWrite: closed
      .reduce((total, task) => total + Number(task?.sourceMessageIds?.length || 0), 0)
  }
}
