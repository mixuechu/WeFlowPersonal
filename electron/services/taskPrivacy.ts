import { redactLocalSecrets } from './sensitiveRedaction.ts'

function safeText(value: unknown, limit: number): string {
  return redactLocalSecrets(String(value || '')).slice(0, limit)
}

export function sanitizeTaskForPersistence<T extends Record<string, any>>(task: T): T {
  const sanitized: Record<string, any> = { ...task }
  const fields: Array<[string, number]> = [
    ['title', 160], ['detail', 500], ['owner', 80], ['source', 100], ['project', 160],
    ['assignmentEvidence', 300], ['ownershipPolicyReason', 500], ['lifecycleEvidence', 300]
  ]
  for (const [field, limit] of fields) {
    if (field in task) sanitized[field] = safeText(task[field], limit)
  }
  if (Array.isArray(task?.collaborators)) {
    sanitized.collaborators = task.collaborators
      .map((value: unknown) => safeText(value, 80)).filter(Boolean).slice(0, 20)
  }
  if (Array.isArray(task?.evidence)) {
    sanitized.evidence = task.evidence.map((item: any) => {
      const evidence = { ...item }
      if ('sender' in item) evidence.sender = safeText(item?.sender, 100)
      if ('excerpt' in item) evidence.excerpt = safeText(item?.excerpt, 300)
      return evidence
    })
  }
  return sanitized as T
}

export function sanitizeTasksForPersistence<T extends Record<string, any>>(tasks: T[]): T[] {
  return (Array.isArray(tasks) ? tasks : []).map(sanitizeTaskForPersistence)
}
