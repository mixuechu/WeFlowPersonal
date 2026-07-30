import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initializeSessionRetryCursors,
  planSessionCursorProgress
} from '../electron/services/ingestionCursorPolicy.ts'

test('first-attempt sessions persist independent retry starts before any source request', () => {
  const initialized = initializeSessionRetryCursors(
    { existing: 1_700_000_000, epoch: 0 },
    ['existing', 'new-success', 'new-failure', 'epoch'],
    1_710_000_000
  )
  assert.deepEqual(initialized.sessionCursors, {
    existing: 1_700_000_000,
    epoch: 0,
    'new-success': 1_710_000_000,
    'new-failure': 1_710_000_000
  })
  assert.deepEqual(initialized.initialized, ['new-success', 'new-failure'])
})

test('mixed source success advances only successful sessions and preserves failed retry origins', () => {
  const initial = initializeSessionRetryCursors(
    {},
    ['successful-chat', 'failed-chat'],
    1_710_000_000
  )
  const progress = planSessionCursorProgress({
    current: initial.sessionCursors,
    successfulSessionIds: ['successful-chat'],
    failedSessionIds: ['failed-chat', 'failed-chat'],
    windowEnd: 1_720_000_000,
    modelBatchesSucceeded: true
  })
  assert.equal(progress.advanceGlobal, true)
  assert.equal(progress.complete, false)
  assert.deepEqual(progress.pendingSessionIds, ['failed-chat'])
  assert.deepEqual(progress.sessionCursors, {
    'successful-chat': 1_720_000_000,
    'failed-chat': 1_710_000_000
  })

  const nextRun = initializeSessionRetryCursors(
    progress.sessionCursors,
    ['successful-chat', 'failed-chat'],
    1_720_000_000 - 300
  )
  assert.deepEqual(nextRun.initialized, [])
  assert.equal(nextRun.sessionCursors['failed-chat'], 1_710_000_000)
})

test('model batch failure advances neither global nor per-session cursors', () => {
  const progress = planSessionCursorProgress({
    current: {
      'chat-a': 1_710_000_000,
      'chat-b': 1_711_000_000
    },
    successfulSessionIds: ['chat-a', 'chat-b'],
    failedSessionIds: [],
    windowEnd: 1_720_000_000,
    modelBatchesSucceeded: false
  })
  assert.equal(progress.advanceGlobal, false)
  assert.equal(progress.complete, false)
  assert.deepEqual(progress.pendingSessionIds, [])
  assert.deepEqual(progress.sessionCursors, {
    'chat-a': 1_710_000_000,
    'chat-b': 1_711_000_000
  })
})

test('all source and model work advances every session and completes the window', () => {
  const progress = planSessionCursorProgress({
    current: { 'chat-a': 1_710_000_000, 'chat-b': 1_710_000_000 },
    successfulSessionIds: ['chat-a', 'chat-b'],
    failedSessionIds: [],
    windowEnd: 1_720_000_000,
    modelBatchesSucceeded: true
  })
  assert.equal(progress.advanceGlobal, true)
  assert.equal(progress.complete, true)
  assert.deepEqual(progress.sessionCursors, {
    'chat-a': 1_720_000_000,
    'chat-b': 1_720_000_000
  })
})
