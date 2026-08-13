import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createModelBatchMemoryGuard,
  resolveNewModelTaskDependencies
} from '../electron/services/modelBatchMemoryGuard.ts'

test('model batch memory guard restores state and pending evidence before authority commits', () => {
  let state = { entities: ['existing'], tasks: ['existing-task'] }
  let evidence = [{ messageId: 'existing-message' }]
  const guard = createModelBatchMemoryGuard({
    stateSnapshot: structuredClone(state),
    evidenceSnapshot: [...evidence],
    restore: (snapshot, pendingEvidence) => {
      state = snapshot
      evidence = pendingEvidence
    }
  })
  state.entities.push('uncommitted')
  state.tasks.push('uncommitted-task')
  evidence.push({ messageId: 'uncommitted-message' })

  assert.equal(guard.rollbackUncommitted(), true)
  assert.deepEqual(state, { entities: ['existing'], tasks: ['existing-task'] })
  assert.deepEqual(evidence, [{ messageId: 'existing-message' }])
})

test('model batch memory guard retains memory after SQL authority commits', () => {
  let state = { entities: ['existing'] }
  let evidence = [{ messageId: 'existing-message' }]
  const guard = createModelBatchMemoryGuard({
    stateSnapshot: structuredClone(state),
    evidenceSnapshot: [...evidence],
    restore: (snapshot, pendingEvidence) => {
      state = snapshot
      evidence = pendingEvidence
    }
  })
  state.entities.push('committed')
  evidence.push({ messageId: 'committed-message' })
  guard.markAuthorityCommitted()

  assert.equal(guard.rollbackUncommitted(), false)
  assert.deepEqual(state.entities, ['existing', 'committed'])
  assert.deepEqual(evidence.map(item => item.messageId), ['existing-message', 'committed-message'])
})

test('model task dependencies bind final deduplicated ids before the atomic commit', () => {
  const created = {
    id: 'new-task',
    title: '交付演示',
    dependsOnIds: []
  }
  const existing = {
    id: 'existing-final-id',
    title: '确认需求',
    dependsOnIds: []
  }
  const protectedExisting = {
    id: 'protected-task',
    title: '保留人工依赖',
    dependsOnIds: ['manual-dependency']
  }
  const changes = [{
    taskId: created.id,
    before: {},
    after: created
  }, {
    taskId: protectedExisting.id,
    before: structuredClone(protectedExisting),
    after: protectedExisting
  }]

  resolveNewModelTaskDependencies({
    tasks: [existing, created, protectedExisting],
    changes,
    dependencyTitlesByTaskId: new Map([
      [created.id, ['确认需求']],
      [protectedExisting.id, ['交付演示']]
    ])
  })

  assert.deepEqual(created.dependsOnIds, ['existing-final-id'])
  assert.deepEqual(protectedExisting.dependsOnIds, ['manual-dependency'])
})
