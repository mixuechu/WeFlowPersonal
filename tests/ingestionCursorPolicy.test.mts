import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initializeSessionRetryCursors,
  nextSessionContinuationOffset,
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
  assert.deepEqual(progress.backlogSessionIds, [])
  assert.deepEqual(progress.sessionOffsets, {})
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
  assert.deepEqual(progress.backlogSessionIds, [])
  assert.deepEqual(progress.sessionOffsets, {})
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
  assert.deepEqual(progress.sessionOffsets, {})
})

test('saturated ascending pagination commits a continuation without advancing that session', () => {
  assert.equal(nextSessionContinuationOffset(0, 10_000, true), 9_980)
  assert.equal(nextSessionContinuationOffset(9_980, 19_980, true), 19_960)
  assert.equal(nextSessionContinuationOffset(19_960, 20_050, false), 0)
  const firstChunk = planSessionCursorProgress({
    current: {
      'busy-chat': 1_710_000_000,
      'normal-chat': 1_710_000_000
    },
    currentOffsets: {},
    successfulSessionIds: ['busy-chat', 'normal-chat'],
    failedSessionIds: [],
    continuationOffsets: { 'busy-chat': 9_980 },
    windowEnd: 1_720_000_000,
    modelBatchesSucceeded: true
  })
  assert.equal(firstChunk.advanceGlobal, true)
  assert.equal(firstChunk.complete, false)
  assert.deepEqual(firstChunk.backlogSessionIds, ['busy-chat'])
  assert.deepEqual(firstChunk.sessionCursors, {
    'busy-chat': 1_710_000_000,
    'normal-chat': 1_720_000_000
  })
  assert.deepEqual(firstChunk.sessionOffsets, { 'busy-chat': 9_980 })

  const failedRetry = planSessionCursorProgress({
    current: firstChunk.sessionCursors,
    currentOffsets: firstChunk.sessionOffsets,
    successfulSessionIds: ['busy-chat'],
    failedSessionIds: [],
    continuationOffsets: { 'busy-chat': 19_960 },
    windowEnd: 1_730_000_000,
    modelBatchesSucceeded: false
  })
  assert.equal(failedRetry.advanceGlobal, false)
  assert.equal(failedRetry.sessionCursors['busy-chat'], 1_710_000_000)
  assert.equal(failedRetry.sessionOffsets['busy-chat'], 9_980)
  assert.deepEqual(failedRetry.backlogSessionIds, ['busy-chat'])
  assert.equal(failedRetry.complete, false)

  const completedRetry = planSessionCursorProgress({
    current: firstChunk.sessionCursors,
    currentOffsets: firstChunk.sessionOffsets,
    successfulSessionIds: ['busy-chat'],
    failedSessionIds: [],
    continuationOffsets: {},
    windowEnd: 1_730_000_000,
    modelBatchesSucceeded: true
  })
  assert.equal(completedRetry.complete, true)
  assert.equal(completedRetry.sessionCursors['busy-chat'], 1_730_000_000)
  assert.deepEqual(completedRetry.sessionOffsets, {})
})

test('source failure preserves an existing high-volume continuation offset', () => {
  const progress = planSessionCursorProgress({
    current: { 'busy-chat': 1_710_000_000 },
    currentOffsets: { 'busy-chat': 19_960 },
    successfulSessionIds: [],
    failedSessionIds: ['busy-chat'],
    continuationOffsets: {},
    windowEnd: 1_730_000_000,
    modelBatchesSucceeded: true
  })
  assert.equal(progress.complete, false)
  assert.deepEqual(progress.pendingSessionIds, ['busy-chat'])
  assert.deepEqual(progress.backlogSessionIds, ['busy-chat'])
  assert.equal(progress.sessionCursors['busy-chat'], 1_710_000_000)
  assert.equal(progress.sessionOffsets['busy-chat'], 19_960)
})
