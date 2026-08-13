import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildActiveTaskWorksetScopeToken,
  buildTaskCalendarScopeToken
} from '../electron/services/taskDirectoryScope.ts'
import { computeProjectDirectoryScopeToken } from '../electron/services/projectDirectoryScope.ts'

test('active task workset scope covers every effective filter and ignores pagination', () => {
  const base = {
    taskId: 'task-A', status: 'doing', priority: 'high', taskKind: 'delegated', query: ' 客户 '
  }
  const token = buildActiveTaskWorksetScopeToken({ ...base, offset: 0, limit: 20 } as any)
  assert.equal(token, buildActiveTaskWorksetScopeToken({ ...base, offset: 100, limit: 200 } as any))
  for (const changed of [
    { ...base, taskId: 'task-B' },
    { ...base, status: 'waiting' },
    { ...base, priority: 'low' },
    { ...base, taskKind: 'action' },
    { ...base, query: '另一范围' }
  ]) assert.notEqual(token, buildActiveTaskWorksetScopeToken(changed))
})

test('task calendar scope covers month and all effective filters', () => {
  const base = {
    month: '2026-08', status: 'todo', priority: 'medium', taskKind: 'action', query: '发布'
  }
  const token = buildTaskCalendarScopeToken(base)
  for (const changed of [
    { ...base, month: '2026-09' },
    { ...base, status: 'doing' },
    { ...base, priority: 'high' },
    { ...base, taskKind: 'waiting' },
    { ...base, query: '复盘' }
  ]) assert.notEqual(token, buildTaskCalendarScopeToken(changed))
})

test('scope normalization matches task directory effective defaults', () => {
  assert.equal(
    buildActiveTaskWorksetScopeToken({ status: 'invalid', query: ' 客户 ' }),
    buildActiveTaskWorksetScopeToken({ status: 'all', query: '客户' })
  )
  assert.equal(
    buildTaskCalendarScopeToken({ month: 'invalid', priority: 'invalid' }),
    buildTaskCalendarScopeToken({ month: '', priority: '' })
  )
})

test('project directory scope binds filters and the Shanghai day boundary', () => {
  const base = { query: ' 客户项目 ', phase: 'active', today: '2026-08-13' }
  const token = computeProjectDirectoryScopeToken(base)
  assert.equal(token, computeProjectDirectoryScopeToken({
    query: '客户项目', phase: 'active', today: '2026-08-13'
  }))
  assert.notEqual(token, computeProjectDirectoryScopeToken({ ...base, phase: 'planned' }))
  assert.notEqual(token, computeProjectDirectoryScopeToken({ ...base, today: '2026-08-14' }))
})
