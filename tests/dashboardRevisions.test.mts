import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDashboardRevisions,
  buildGraphWorkspaceRevision,
  type DashboardRevisionSource
} from '../electron/services/dashboardRevisions.ts'

function revisionSource(values: Partial<Record<string, string>> = {}): DashboardRevisionSource {
  return {
    getGraphReviewRevision: () => values.graph || 'graph-1',
    getTaskArchiveRevision: () => values.task || 'task-1',
    getStructuredMemoryRevision: () => values.memory || 'memory-1',
    getTaskOwnershipReviewRevision: () => values.ownership || 'ownership-1',
    getIdentityMergeArchiveRevision: () => values.merge || 'merge-1',
    getMemoryDeletionAuditRevision: () => values.deletion || 'deletion-1',
    getAssistantHistoryRevision: () => values.assistant || 'assistant-1'
  }
}

test('dashboard refresh tokens follow authoritative revisions even when visible counts stay equal', () => {
  const before = buildDashboardRevisions(revisionSource())
  const graphChanged = buildDashboardRevisions(revisionSource({ graph: 'graph-2' }))
  const taskChanged = buildDashboardRevisions(revisionSource({ task: 'task-2' }))
  const memoryChanged = buildDashboardRevisions(revisionSource({ memory: 'memory-2' }))
  const ownershipChanged = buildDashboardRevisions(revisionSource({ ownership: 'ownership-2' }))

  assert.notEqual(graphChanged.graph, before.graph)
  assert.notEqual(graphChanged.project, before.project)
  assert.notEqual(taskChanged.task, before.task)
  assert.notEqual(taskChanged.project, before.project)
  assert.notEqual(memoryChanged.structuredMemory, before.structuredMemory)
  assert.notEqual(memoryChanged.project, before.project)
  assert.notEqual(ownershipChanged.taskOwnership, before.taskOwnership)
  assert.equal(ownershipChanged.graph, before.graph)
  assert.equal(ownershipChanged.project, before.project)
})

test('independent audit revisions invalidate only their matching dashboard archives', () => {
  const before = buildDashboardRevisions(revisionSource())
  const after = buildDashboardRevisions(revisionSource({
    merge: 'merge-2',
    deletion: 'deletion-2',
    assistant: 'assistant-2'
  }))

  assert.notEqual(after.identityMerge, before.identityMerge)
  assert.notEqual(after.memoryDeletion, before.memoryDeletion)
  assert.notEqual(after.assistantHistory, before.assistantHistory)
  assert.equal(after.graph, before.graph)
  assert.equal(after.task, before.task)
  assert.equal(after.project, before.project)
})

test('focused graph workspaces bind graph memory and task revisions while overview stays graph-only', () => {
  const base = revisionSource()
  const overview = buildGraphWorkspaceRevision(base, false)
  const focused = buildGraphWorkspaceRevision(base, true)

  assert.equal(
    buildGraphWorkspaceRevision(revisionSource({ task: 'task-2' }), false),
    overview
  )
  assert.equal(
    buildGraphWorkspaceRevision(revisionSource({ memory: 'memory-2' }), false),
    overview
  )
  assert.notEqual(
    buildGraphWorkspaceRevision(revisionSource({ task: 'task-2' }), true),
    focused
  )
  assert.notEqual(
    buildGraphWorkspaceRevision(revisionSource({ memory: 'memory-2' }), true),
    focused
  )
  assert.notEqual(
    buildGraphWorkspaceRevision(revisionSource({ graph: 'graph-2' }), true),
    focused
  )
})
