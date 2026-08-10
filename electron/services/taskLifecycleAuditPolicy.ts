export const TASK_LIFECYCLE_AUDIT_VERSION = 'task-lifecycle-audit-v1'

export type TaskLifecycleAuditPlan = {
  action: 'close' | 'keep' | 'skip'
  status?: 'done' | 'cancelled'
  reason: string
  evidenceIds: string[]
}

export function classifyTaskLifecycleAuditRequestFailure(input: {
  name?: unknown
  message?: unknown
}): 'cancelled' | 'timeout' | 'request_failed' {
  if (String(input?.name || '') === 'AbortError') return 'cancelled'
  return /timeout|超时|超过\s*\d+\s*秒/i.test(String(input?.message || ''))
    ? 'timeout'
    : 'request_failed'
}

export function canResumeTaskLifecycleAudit(input: {
  running: unknown
  total: unknown
  processed: unknown
  candidateIds: unknown
  nextOffset: unknown
}): boolean {
  if (Boolean(input.running)) return false
  const total = Math.max(0, Math.floor(Number(input.total) || 0))
  const processed = Math.max(0, Math.floor(Number(input.processed) || 0))
  const candidateIds = Array.isArray(input.candidateIds)
    ? input.candidateIds.map(value => String(value || '').trim())
    : []
  if (!total || processed <= 0 || processed >= total) return false
  if (candidateIds.length !== total || new Set(candidateIds).size !== total ||
      candidateIds.some(id => !id)) return false
  return Math.max(0, Math.floor(Number(input.nextOffset) || 0)) === processed
}

export function selectTaskLifecycleAuditEvidence<T>(items: T[], limit = 20): T[] {
  const list = Array.isArray(items) ? items : []
  const boundedLimit = Math.max(1, Math.min(40, Math.floor(Number(limit) || 20)))
  if (list.length <= boundedLimit) return [...list]
  const head = Math.min(5, Math.floor(boundedLimit / 2))
  return [...list.slice(0, head), ...list.slice(-(boundedLimit - head))]
}

export function planTaskLifecycleAuditDecision(input: {
  currentExists: boolean
  currentStatus: unknown
  currentMutationToken: string
  expectedMutationToken: string
  decision?: any
  allowedEvidenceIds: string[]
  minimumConfidence?: number
}): TaskLifecycleAuditPlan {
  if (!input.currentExists || input.currentMutationToken !== input.expectedMutationToken ||
      !['todo', 'doing', 'waiting'].includes(String(input.currentStatus || ''))) {
    return { action: 'skip', reason: 'task_changed_after_snapshot', evidenceIds: [] }
  }
  const lifecycle = String(input.decision?.lifecycle || '')
  const confidence = Number(input.decision?.confidence || 0)
  const allowed = new Set(input.allowedEvidenceIds.map(String))
  const evidenceIds = [...new Set((Array.isArray(input.decision?.evidenceIds)
    ? input.decision.evidenceIds : []).map(String).filter(id => allowed.has(id)))]
  if (!['completed', 'cancelled'].includes(lifecycle)) {
    return { action: 'keep', reason: 'no_terminal_lifecycle', evidenceIds }
  }
  if (confidence < Number(input.minimumConfidence ?? 0.9)) {
    return { action: 'keep', reason: 'terminal_confidence_below_threshold', evidenceIds }
  }
  if (!evidenceIds.length) {
    return { action: 'keep', reason: 'terminal_evidence_not_grounded', evidenceIds: [] }
  }
  return {
    action: 'close',
    status: lifecycle === 'completed' ? 'done' : 'cancelled',
    reason: lifecycle === 'completed'
      ? 'model_lifecycle_audit_completed_v1'
      : 'model_lifecycle_audit_cancelled_v1',
    evidenceIds
  }
}
