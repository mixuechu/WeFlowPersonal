export function createModelBatchMemoryGuard<TState, TEvidence>(input: {
  stateSnapshot: TState
  evidenceSnapshot: TEvidence[]
  restore: (state: TState, evidence: TEvidence[]) => void
}): {
  markAuthorityCommitted: () => void
  rollbackUncommitted: () => boolean
} {
  let authorityCommitted = false
  return {
    markAuthorityCommitted: () => {
      authorityCommitted = true
    },
    rollbackUncommitted: () => {
      if (authorityCommitted) return false
      input.restore(input.stateSnapshot, input.evidenceSnapshot)
      return true
    }
  }
}

export function resolveNewModelTaskDependencies(input: {
  tasks: Array<{ id: string; title?: string }>
  changes: Array<{ taskId: string; before: any; after: any }>
  dependencyTitlesByTaskId: Map<string, string[]>
}): void {
  const taskIdsByTitle = new Map(input.tasks
    .map(task => [String(task.title || '').trim().toLowerCase(), task.id] as const)
    .filter(([title]) => Boolean(title)))
  for (const change of input.changes) {
    if (Array.isArray(change.before?.dependsOnIds)) continue
    change.after.dependsOnIds = (input.dependencyTitlesByTaskId.get(change.taskId) || [])
      .map(title => taskIdsByTitle.get(String(title || '').trim().toLowerCase()))
      .filter(Boolean)
  }
}
