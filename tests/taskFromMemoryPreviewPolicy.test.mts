import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertTaskFromMemoryPreview,
  buildTaskFromMemoryPreviewToken,
  type TaskFromMemoryPreviewIdentity
} from '../electron/services/taskFromMemoryPreviewPolicy.ts'

const identity: TaskFromMemoryPreviewIdentity = {
  assistantMessageId: 'answer-1',
  answerContentSha256: 'a'.repeat(64),
  groundingSha256: 'b'.repeat(64),
  evidenceSha256: 'c'.repeat(64),
  taskId: 'task_memory_1',
  currentTaskToken: 'd'.repeat(64)
}

test('task-from-memory preview binds the answer, evidence and existing task state', () => {
  const token = buildTaskFromMemoryPreviewToken(identity)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.doesNotThrow(() => assertTaskFromMemoryPreview(identity, token))
  assert.throws(() => assertTaskFromMemoryPreview({
    ...identity,
    evidenceSha256: 'e'.repeat(64)
  }, token), /重新预览/)
  assert.throws(() => assertTaskFromMemoryPreview({
    ...identity,
    currentTaskToken: 'f'.repeat(64)
  }, token), /重新预览/)
  assert.throws(() => assertTaskFromMemoryPreview(identity, ''), /重新预览/)
})
