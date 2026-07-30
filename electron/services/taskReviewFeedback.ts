import crypto from 'node:crypto'

export function taskEvidenceFingerprint(task: any): string {
  const evidenceKeys = [
    ...(Array.isArray(task?.sourceMessageIds) ? task.sourceMessageIds : []),
    ...(Array.isArray(task?.sourceEvidenceKeys) ? task.sourceEvidenceKeys : []),
    ...(Array.isArray(task?.evidence) ? task.evidence.map((item: any) => item?.messageId) : [])
  ].map(value => String(value || '').trim()).filter(Boolean).sort()
  if (!evidenceKeys.length) return ''
  return crypto.createHash('sha256').update([
    String(task?.sourceSessionId || task?.source || '').trim(),
    ...new Set(evidenceKeys)
  ].join('|')).digest('hex')
}

export function applyTaskReviewFeedback(task: any, feedback: any): any | null {
  if (feedback?.decision === 'rejected') return null
  if (feedback?.decision !== 'mine') return task
  return {
    ...task,
    classification: 'mine',
    ownershipPolicyReason: '相同原文证据此前已由用户确认为我的待办'
  }
}
