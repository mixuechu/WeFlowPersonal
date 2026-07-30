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

export function reconcileTasksWithReviewDecisions(tasks: any[], decisions: any[]): {
  tasks: any[]
  effects: Array<{ evidenceFingerprint: string; action: 'removed' | 'confirmed' | 'restored' }>
  checked: number
} {
  const active = new Map(decisions
    .filter(decision => !decision?.revoked_at && decision?.evidence_fingerprint)
    .map(decision => [String(decision.evidence_fingerprint), decision]))
  const effects: Array<{ evidenceFingerprint: string; action: 'removed' | 'confirmed' | 'restored' }> = []
  const seen = new Set<string>()
  const reconciled: any[] = []
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const fingerprint = taskEvidenceFingerprint(task)
    const decision = fingerprint ? active.get(fingerprint) : null
    if (!decision) {
      reconciled.push(task)
      continue
    }
    seen.add(fingerprint)
    if (decision.decision === 'rejected') {
      effects.push({ evidenceFingerprint: fingerprint, action: 'removed' })
      continue
    }
    if (decision.decision === 'mine' && task.classification !== 'mine') {
      reconciled.push(applyTaskReviewFeedback(task, decision))
      effects.push({ evidenceFingerprint: fingerprint, action: 'confirmed' })
    } else {
      reconciled.push(task)
    }
  }
  const taskIds = new Set(reconciled.map(task => String(task?.id || '')).filter(Boolean))
  for (const [fingerprint, decision] of active) {
    if (seen.has(fingerprint) || decision.decision !== 'mine') continue
    const snapshot = decision.task
    if (!snapshot?.id || !snapshot?.title || taskIds.has(String(snapshot.id))) continue
    reconciled.unshift({
      ...snapshot,
      classification: 'mine',
      ownershipPolicyReason: '启动恢复：相同原文证据此前已由用户确认为我的待办'
    })
    taskIds.add(String(snapshot.id))
    effects.push({ evidenceFingerprint: fingerprint, action: 'restored' })
  }
  return { tasks: reconciled, effects, checked: active.size }
}
