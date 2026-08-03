import crypto from 'node:crypto'

export type DashboardRevisionSource = {
  getGraphReviewRevision(): string
  getTaskArchiveRevision(): string
  getStructuredMemoryRevision(): string
  getTaskOwnershipReviewRevision(): string
  getIdentityMergeArchiveRevision(): string
  getMemoryDeletionAuditRevision(): string
  getAssistantHistoryRevision(): string
}

export function buildDashboardRevisions(source: DashboardRevisionSource): {
  graph: string
  project: string
  task: string
  taskOwnership: string
  structuredMemory: string
  identityMerge: string
  memoryDeletion: string
  assistantHistory: string
} {
  const graph = source.getGraphReviewRevision()
  const task = source.getTaskArchiveRevision()
  const structuredMemory = source.getStructuredMemoryRevision()
  return {
    graph,
    project: crypto.createHash('sha256')
      .update([graph, task, structuredMemory].join('\u0000'))
      .digest('hex')
      .slice(0, 24),
    task,
    taskOwnership: source.getTaskOwnershipReviewRevision(),
    structuredMemory,
    identityMerge: source.getIdentityMergeArchiveRevision(),
    memoryDeletion: source.getMemoryDeletionAuditRevision(),
    assistantHistory: source.getAssistantHistoryRevision()
  }
}
