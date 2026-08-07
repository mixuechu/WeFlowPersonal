import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectCreatedTasksForRun,
  countCreatedTasks
} from '../electron/services/taskRunChangePolicy.ts'

test('historical task updates never become new tasks for the current run', () => {
  const created = collectCreatedTasksForRun(new Map(), [{
    taskId: 'historical',
    before: { id: 'historical', title: '旧标题' },
    after: { id: 'historical', title: '补充了证据' }
  }])
  assert.equal(created.size, 0)
  assert.equal(countCreatedTasks([{
    taskId: 'historical',
    before: { id: 'historical' },
    after: { id: 'historical' }
  }]), 0)
})

test('one newly created task keeps its latest same-run update and counts once', () => {
  const created = collectCreatedTasksForRun(new Map(), [{
    taskId: 'new-task',
    before: {},
    after: { id: 'new-task', title: '初次标题', classification: 'uncertain' }
  }, {
    taskId: 'new-task',
    before: { id: 'new-task', title: '初次标题' },
    after: { id: 'new-task', title: '最终标题', classification: 'mine' }
  }])
  assert.equal(created.size, 1)
  assert.deepEqual(created.get('new-task'), {
    id: 'new-task',
    title: '最终标题',
    classification: 'mine'
  })
})

test('mixed task changes count only distinct authoritative creations', () => {
  const changes = [{
    taskId: 'new-a',
    before: {},
    after: { id: 'new-a' }
  }, {
    taskId: 'existing',
    before: { id: 'existing' },
    after: { id: 'existing' }
  }, {
    taskId: 'new-b',
    before: null,
    after: { id: 'new-b' }
  }, {
    taskId: 'new-a',
    before: { id: 'new-a' },
    after: { id: 'new-a' }
  }]
  assert.equal(countCreatedTasks(changes), 2)
})
