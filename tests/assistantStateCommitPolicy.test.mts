import test from 'node:test'
import assert from 'node:assert/strict'

import { commitAssistantState } from '../electron/services/assistantStateCommitPolicy.ts'

test('strict assistant state commit writes only after both authorities succeed', () => {
  const order: string[] = []
  const result = commitAssistantState({
    strict: true,
    syncGraph: () => order.push('graph'),
    syncTasks: () => order.push('tasks'),
    writeEncryptedState: () => order.push('state')
  })
  assert.deepEqual(order, ['graph', 'tasks', 'state'])
  assert.deepEqual(result, {
    graphSynced: true,
    tasksSynced: true,
    stateWritten: true
  })
})

test('strict graph failure cannot touch task authority or encrypted state', () => {
  const order: string[] = []
  assert.throws(() => commitAssistantState({
    strict: true,
    syncGraph: () => {
      order.push('graph')
      throw new Error('graph unavailable')
    },
    syncTasks: () => order.push('tasks'),
    writeEncryptedState: () => order.push('state'),
    onGraphError: () => order.push('graph-error')
  }), /graph unavailable/)
  assert.deepEqual(order, ['graph', 'graph-error'])
})

test('strict task failure leaves encrypted state at its previous checkpoint', () => {
  const order: string[] = []
  assert.throws(() => commitAssistantState({
    strict: true,
    syncGraph: () => order.push('graph'),
    syncTasks: () => {
      order.push('tasks')
      throw new Error('task authority unavailable')
    },
    writeEncryptedState: () => order.push('state'),
    onTaskError: () => order.push('task-error')
  }), /task authority unavailable/)
  assert.deepEqual(order, ['graph', 'tasks', 'task-error'])
})

test('best-effort runtime state preserves legacy degradation semantics', () => {
  const order: string[] = []
  const result = commitAssistantState({
    strict: false,
    syncGraph: () => {
      order.push('graph')
      throw new Error('graph unavailable')
    },
    syncTasks: () => {
      order.push('tasks')
      throw new Error('tasks unavailable')
    },
    writeEncryptedState: () => order.push('state'),
    onGraphError: () => order.push('graph-error'),
    onTaskError: () => order.push('task-error')
  })
  assert.deepEqual(order, ['graph', 'graph-error', 'state', 'tasks', 'task-error'])
  assert.deepEqual(result, {
    graphSynced: false,
    tasksSynced: false,
    stateWritten: true
  })
})
