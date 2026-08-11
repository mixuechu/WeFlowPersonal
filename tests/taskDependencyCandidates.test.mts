import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildTaskDependencyCandidates } from '../shared/taskDependencyCandidates.ts'

const serviceSource = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../electron/services/personalMemoryStore.ts', import.meta.url), 'utf8')

test('production dependency search delegates to SQLCipher without scanning runtime tasks', () => {
  const serviceMethod = serviceSource.slice(
    serviceSource.indexOf('  getTaskDependencyCandidates('),
    serviceSource.indexOf('\n  getTaskArchive(', serviceSource.indexOf('  getTaskDependencyCandidates('))
  )
  assert.match(serviceMethod, /personalMemoryStore\.listTaskDependencyCandidates\(/)
  assert.doesNotMatch(serviceMethod, /this\.state\.tasks|buildTaskDependencyCandidates/)
  const storeMethod = storeSource.slice(
    storeSource.indexOf('  listTaskDependencyCandidates('),
    storeSource.indexOf('\n  listTaskArchive(', storeSource.indexOf('  listTaskDependencyCandidates('))
  )
  assert.match(storeMethod, /FROM task_directory task/)
  assert.match(storeMethod, /ROW_NUMBER\(\) OVER\(PARTITION BY is_selected/)
  assert.match(storeMethod, /is_selected=1 OR item_rank<=\?/)
})

test('task history and review revert reads use SQLCipher stable ids', () => {
  const historyMethod = serviceSource.slice(
    serviceSource.indexOf('  getTaskHistoryPage('),
    serviceSource.indexOf('\n  getTaskDependencyCandidates(', serviceSource.indexOf('  getTaskHistoryPage('))
  )
  const reviewStart = serviceSource.indexOf('  getTaskReviewDecisionPage(')
  const reviewMethods = serviceSource.slice(
    reviewStart, serviceSource.indexOf('\n  getMemoryDeletionAuditPage(', reviewStart)
  )
  assert.doesNotMatch(historyMethod, /this\.state\.tasks/)
  assert.match(historyMethod, /personalMemoryStore\.listTaskHistoryPage\(/)
  assert.match(historyMethod, /requireCurrentTask: true/)
  assert.doesNotMatch(reviewMethods, /this\.state\.tasks/)
  assert.match(storeSource, /EXISTS\(SELECT 1 FROM task_directory task WHERE task\.id=task_review_decisions\.task_id\)/)
  assert.match(storeSource, /EXISTS\(SELECT 1 FROM task_directory task WHERE task\.id=decision\.task_id\)/)
})

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
