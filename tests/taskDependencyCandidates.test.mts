import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskDependencyCandidates } from '../shared/taskDependencyCandidates.ts'

test('task dependency search covers the authoritative collection and preserves selected tasks', () => {
  const tasks = Array.from({ length: 2_000 }, (_, index) => ({
    id: `dependency-task-${String(index).padStart(4, '0')}`,
    title: index === 1777 ? '跨页面特殊依赖任务' : `长期任务 ${index}`,
    detail: `任务详情 ${index}`,
    owner: '我',
    project: `项目 ${index % 20}`,
    status: index % 11 === 0 ? 'done' : index % 17 === 0 ? 'cancelled' : 'todo',
    priority: ['high', 'medium', 'low'][index % 3],
    classification: index % 19 === 0 ? 'others' : 'mine',
    updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString()
  }))
  const result = buildTaskDependencyCandidates(tasks, {
    query: '跨页面特殊依赖',
    selectedIds: ['dependency-task-0000', 'dependency-task-0017'],
    excludeId: 'dependency-task-1999',
    limit: 20
  }, 'task-revision-1')
  assert.equal(result.stale, false)
  assert.equal(result.items.some(item => item.id === 'dependency-task-1777'), true)
  assert.equal(result.items[0].id, 'dependency-task-0000')
  assert.equal(result.items[1].id, 'dependency-task-0017')
  assert.equal(result.items.some(item => 'detail' in item || 'evidence' in item), false)
})

test('task dependency search rejects stale revisions and excludes unsafe ordinary candidates', () => {
  const tasks = [{
    id: 'self',
    title: '当前任务',
    status: 'todo',
    classification: 'mine'
  }, {
    id: 'mine',
    title: '我的候选',
    status: 'todo',
    classification: 'mine'
  }, {
    id: 'others',
    title: '他人的候选',
    status: 'todo',
    classification: 'others'
  }, {
    id: 'cancelled',
    title: '已取消候选',
    status: 'cancelled',
    classification: 'mine'
  }]
  const current = buildTaskDependencyCandidates(tasks, {
    excludeId: 'self',
    selectedIds: ['cancelled']
  }, 'task-revision-2')
  assert.deepEqual(current.items.map(item => item.id), ['cancelled', 'mine'])
  const stale = buildTaskDependencyCandidates(tasks, {
    excludeId: 'self',
    revision: 'task-revision-1'
  }, 'task-revision-2')
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
})
