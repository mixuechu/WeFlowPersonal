import { boundedEvidencePayload, MEMORY_CARD_EVIDENCE_LIMIT } from './evidencePayload.ts'

export const TASK_DIRECTORY_PAYLOAD_VERSION = 'task-directory-v1'
export const TASK_DOSSIER_PAYLOAD_VERSION = 'task-dossier-v1'
export const TASK_HISTORY_LIMIT = 100

export function buildTaskDirectoryItem(task: any): any {
  const {
    evidence: _evidence,
    sourceMessageIds: _sourceMessageIds,
    ...directory
  } = task || {}
  return {
    ...directory,
    evidenceTotal: Array.isArray(task?.evidence) ? task.evidence.length : 0
  }
}

export function buildTaskDossier(task: any, history: any[], historyTotal = history.length): any {
  if (!task) return null
  return {
    task: {
      ...task,
      ...boundedEvidencePayload(task.evidence, MEMORY_CARD_EVIDENCE_LIMIT)
    },
    history: Array.isArray(history) ? history.slice(0, TASK_HISTORY_LIMIT) : [],
    historyTotal: Math.max(Number(historyTotal || 0), Array.isArray(history) ? history.length : 0),
    payloadPolicy: {
      version: TASK_DOSSIER_PAYLOAD_VERSION,
      evidenceLimit: MEMORY_CARD_EVIDENCE_LIMIT,
      historyLimit: TASK_HISTORY_LIMIT,
      loadedOnDemand: true
    }
  }
}
