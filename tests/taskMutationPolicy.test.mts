import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertTaskMutationBatch,
  assertTaskMutationToken,
  buildTaskMutationToken,
  classifyTaskMutationRecovery
} from '../electron/services/taskMutationPolicy.ts'

const task = {
  id: 'task_1',
  title: '提交方案',
  detail: '发给客户',
  owner: '我',
  collaborators: ['小王'],
  project: '演示项目',
  dependsOnIds: [],
  taskKind: 'action',
  due: '2026-08-05',
  priority: 'high',
  status: 'todo',
  classification: 'mine',
  updatedAt: '2026-08-04T00:00:00.000Z',
  evidence: [{
    sourceId: 'wechat',
    sessionId: 'chat_1',
    messageId: 'message_1',
    timestamp: 123,
    sender: '小王',
    excerpt: '明天把方案发我'
  }]
}

test('task mutation token binds visible fields and complete evidence', () => {
  const token = buildTaskMutationToken(task)
  assert.doesNotThrow(() => assertTaskMutationToken(task, token))
  for (const changed of [
    { ...task, status: 'doing' },
    { ...task, title: '提交最终方案' },
    { ...task, updatedAt: '2026-08-04T00:00:01.000Z' },
    { ...task, evidence: [{ ...task.evidence[0], excerpt: '原文已更新' }] }
  ]) {
    assert.throws(() => assertTaskMutationToken(changed, token), /已经被更新/)
  }
})

test('batch validation rejects every update before a stale member can be applied', () => {
  const second = { ...task, id: 'task_2', title: '准备演示' }
  assert.doesNotThrow(() => assertTaskMutationBatch([task, second], [
    { id: task.id, mutationToken: buildTaskMutationToken(task) },
    { id: second.id, mutationToken: buildTaskMutationToken(second) }
  ]))
  assert.throws(() => assertTaskMutationBatch([task, { ...second, status: 'done' }], [
    { id: task.id, mutationToken: buildTaskMutationToken(task) },
    { id: second.id, mutationToken: buildTaskMutationToken(second) }
  ]), /已经被更新/)
  assert.throws(() => assertTaskMutationBatch([task], [
    { id: task.id, mutationToken: buildTaskMutationToken(task) },
    { id: task.id, mutationToken: buildTaskMutationToken(task) }
  ]), /重复项目/)
})

test('prepared task recovery applies, abandons or preserves only exact states', () => {
  const after = { ...task, status: 'done', updatedAt: '2026-08-04T00:01:00.000Z' }
  const beforeTokens = { [task.id]: buildTaskMutationToken(task) }
  const afterTokens = { [task.id]: buildTaskMutationToken(after) }
  assert.equal(classifyTaskMutationRecovery([after], beforeTokens, afterTokens), 'apply')
  assert.equal(classifyTaskMutationRecovery([task], beforeTokens, afterTokens), 'abandon')
  assert.equal(classifyTaskMutationRecovery([
    { ...task, status: 'doing', updatedAt: '2026-08-04T00:00:30.000Z' }
  ], beforeTokens, afterTokens), 'conflict')
  assert.equal(classifyTaskMutationRecovery([], {}, {}), 'conflict')
})
