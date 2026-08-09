import { compactGraphReviewWorkset } from './graphReviewStorage.ts'

export const TASK_STATE_STORAGE_VERSION = 'task-state-storage-v3'
export const ACTIVE_TASK_STATE_EVIDENCE_LIMIT = 50
export const ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT = 50

export function taskIsClosed(task: any): boolean {
  return task?.status === 'done' || task?.status === 'cancelled'
}

export function compactTaskForEncryptedState(task: any): any {
  if (!taskIsClosed(task)) {
    const evidence = Array.isArray(task?.evidence) ? task.evidence : []
    const uniqueEvidence = new Map<string, any>()
    for (const item of evidence) {
      const sourceId = String(item?.sourceId || item?.source_id || 'legacy').trim() || 'legacy'
      const sessionId = String(item?.sessionId || item?.session_id || '').trim()
      const messageId = String(item?.messageId || item?.message_id || '').trim()
      if (!messageId) continue
      const key = `${sourceId}\0${sessionId}\0${messageId}`
      const previous = uniqueEvidence.get(key)
      if (!previous || Number(item?.timestamp || 0) >= Number(previous?.timestamp || 0)) {
        uniqueEvidence.set(key, item)
      }
    }
    const hotEvidence = [...uniqueEvidence.values()]
      .sort((left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0))
      .slice(-ACTIVE_TASK_STATE_EVIDENCE_LIMIT)
    const messageKeys = [...new Set((Array.isArray(task?.sourceMessageIds)
      ? task.sourceMessageIds : []).map(String).filter(Boolean))]
      .slice(-ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT)
    const compacted: any = {
      ...task,
      evidenceTotal: Math.max(
        uniqueEvidence.size,
        Math.max(0, Number(task?.evidenceTotal || 0))
      ),
      sourceMessageIds: messageKeys
    }
    if (Array.isArray(task?.evidence)) compacted.evidence = hotEvidence
    else delete compacted.evidence
    return compacted
  }
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
  const active = list.filter(task => !taskIsClosed(task))
  const activeCompacted = active.map(compactTaskForEncryptedState)
  const activeAuthoritativeEvidenceRows = active.reduce((total, task) =>
    total + Math.max(
      Number(task?.evidence?.length || 0),
      Math.max(0, Number(task?.evidenceTotal || 0))
    ), 0)
  const activeStoredEvidenceRows = activeCompacted.reduce((total, task) =>
    total + Number(task?.evidence?.length || 0), 0)
  return {
    version: TASK_STATE_STORAGE_VERSION,
    policy: 'active_evidence_hotset_closed_structure_only_sqlcipher_authority',
    tasks: list.length,
    activeTasks: active.length,
    closedTasks: closed.length,
    activeEvidenceLimit: ACTIVE_TASK_STATE_EVIDENCE_LIMIT,
    activeMessageKeyLimit: ACTIVE_TASK_STATE_MESSAGE_KEY_LIMIT,
    activeEvidenceRows: activeStoredEvidenceRows,
    activeEvidenceRowsOmittedOnWrite:
      Math.max(0, activeAuthoritativeEvidenceRows - activeStoredEvidenceRows),
    closedEvidenceRowsOmittedOnWrite: closed
      .reduce((total, task) => total + Number(task?.evidence?.length || 0), 0),
    closedMessageKeysOmittedOnWrite: closed
      .reduce((total, task) => total + Number(task?.sourceMessageIds?.length || 0), 0)
  }
}
