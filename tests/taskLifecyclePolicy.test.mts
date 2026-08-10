import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lifecycleRequiresExistingTask,
  reconcileTaskStatus,
  resolveExtractedTaskLifecycle
} from '../electron/services/taskLifecyclePolicy.ts'

test('new extraction schema requires an explicit task lifecycle', () => {
  assert.deepEqual(resolveExtractedTaskLifecycle({ requireExplicitLifecycle: true }), {
    lifecycle: 'invalid', status: null, reason: 'missing_explicit_task_lifecycle'
  })
  assert.deepEqual(resolveExtractedTaskLifecycle({ lifecycle: 'open', taskKind: 'waiting', requireExplicitLifecycle: true }), {
    lifecycle: 'open', status: 'waiting', reason: 'model_task_open'
  })
})

test('completed and cancelled model items are terminal reconciliation signals', () => {
  assert.equal(resolveExtractedTaskLifecycle({ lifecycle: 'completed' }).status, 'done')
  assert.equal(resolveExtractedTaskLifecycle({ lifecycle: 'cancelled' }).status, 'cancelled')
  assert.equal(lifecycleRequiresExistingTask('completed'), true)
  assert.equal(lifecycleRequiresExistingTask('cancelled'), true)
  assert.equal(lifecycleRequiresExistingTask('open'), false)
})

test('legacy recovered digests remain open-compatible', () => {
  assert.deepEqual(resolveExtractedTaskLifecycle({ taskKind: 'action' }), {
    lifecycle: 'open', status: 'todo', reason: 'legacy_task_assumed_open'
  })
})

test('model lifecycle can close active tasks but cannot rewrite a human terminal decision', () => {
  const completed = resolveExtractedTaskLifecycle({ lifecycle: 'completed' })
  const cancelled = resolveExtractedTaskLifecycle({ lifecycle: 'cancelled' })
  assert.equal(reconcileTaskStatus('doing', completed), 'done')
  assert.equal(reconcileTaskStatus('waiting', cancelled), 'cancelled')
  assert.equal(reconcileTaskStatus('cancelled', completed), 'cancelled')
  assert.equal(reconcileTaskStatus('done', cancelled), 'done')
})
