export type ExtractedTaskLifecycle = 'open' | 'completed' | 'cancelled'

export type TaskLifecycleDecision = {
  lifecycle: ExtractedTaskLifecycle | 'invalid'
  status: 'todo' | 'waiting' | 'done' | 'cancelled' | null
  reason: string
}

export function resolveExtractedTaskLifecycle(input: {
  lifecycle?: unknown
  taskKind?: unknown
  requireExplicitLifecycle?: boolean
}): TaskLifecycleDecision {
  const lifecycle = String(input.lifecycle || '').trim().toLowerCase()
  if (lifecycle === 'completed') return { lifecycle, status: 'done', reason: 'model_task_completed' }
  if (lifecycle === 'cancelled') return { lifecycle, status: 'cancelled', reason: 'model_task_cancelled' }
  if (lifecycle === 'open') {
    return { lifecycle, status: input.taskKind === 'waiting' ? 'waiting' : 'todo', reason: 'model_task_open' }
  }
  if (input.requireExplicitLifecycle) {
    return { lifecycle: 'invalid', status: null, reason: 'missing_explicit_task_lifecycle' }
  }
  return {
    lifecycle: 'open',
    status: input.taskKind === 'waiting' ? 'waiting' : 'todo',
    reason: 'legacy_task_assumed_open'
  }
}

export function lifecycleRequiresExistingTask(lifecycle: ExtractedTaskLifecycle | 'invalid'): boolean {
  return lifecycle === 'completed' || lifecycle === 'cancelled'
}

export function reconcileTaskStatus(
  currentStatus: unknown,
  decision: TaskLifecycleDecision
): 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled' {
  const current = String(currentStatus || '')
  if (current === 'done' || current === 'cancelled') return current
  if (decision.status) return decision.status
  return ['todo', 'doing', 'waiting'].includes(current)
    ? current as 'todo' | 'doing' | 'waiting'
    : 'todo'
}
