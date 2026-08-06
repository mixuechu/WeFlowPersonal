import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_BACKLOG_RETRY_STATE,
  didBacklogProgress,
  isBacklogRetryDue,
  planBacklogRetry
} from '../electron/services/backlogRetryPolicy.ts'

const now = new Date('2026-07-31T02:00:00.000Z')

test('backlog progress includes advancing and completing a persisted session', () => {
  assert.equal(didBacklogProgress({ a: 9_980 }, { a: 19_960 }), true)
  assert.equal(didBacklogProgress({ a: 9_980 }, {}), true)
  assert.equal(didBacklogProgress({ a: 9_980 }, { a: 9_980 }), false)
})

test('healthy backlog progress schedules one bounded continuation without failure backoff', () => {
  const result = planBacklogRetry({
    previous: EMPTY_BACKLOG_RETRY_STATE,
    previousOffsets: {},
    currentOffsets: { busy: 9_980 },
    now,
    operationalFailure: false,
    cancelled: false
  })
  assert.equal(result.failureCount, 0)
  assert.equal(result.paused, false)
  assert.equal(result.nextAttemptAt, '2026-07-31T02:15:00.000Z')
  assert.equal(result.lastProgressAt, now.toISOString())
  assert.equal(result.lastOutcome, 'progressed')
  assert.equal(result.previousBacklogCount, 0)
  assert.equal(result.remainingBacklogCount, 1)
})

test('stalled operational failures back off exponentially and cap at six hours', () => {
  let state = {
    ...EMPTY_BACKLOG_RETRY_STATE,
    failureCount: 5
  }
  state = planBacklogRetry({
    previous: state,
    previousOffsets: { busy: 9_980 },
    currentOffsets: { busy: 9_980 },
    now,
    operationalFailure: true,
    cancelled: false
  })
  assert.equal(state.failureCount, 6)
  assert.equal(state.nextAttemptAt, '2026-07-31T08:00:00.000Z')
})

test('safe cancellation pauses in-session continuation while retaining its offset', () => {
  const state = planBacklogRetry({
    previous: EMPTY_BACKLOG_RETRY_STATE,
    previousOffsets: { busy: 9_980 },
    currentOffsets: { busy: 9_980 },
    now,
    operationalFailure: false,
    cancelled: true
  })
  assert.equal(state.paused, true)
  assert.equal(state.nextAttemptAt, null)
  assert.equal(state.lastOutcome, 'paused')
  assert.equal(state.previousBacklogCount, 1)
  assert.equal(state.remainingBacklogCount, 1)
})

test('drained backlog clears retry state', () => {
  const state = planBacklogRetry({
    previous: {
      ...EMPTY_BACKLOG_RETRY_STATE,
      nextAttemptAt: now.toISOString(),
      failureCount: 3,
      paused: true,
      lastAttemptAt: now.toISOString(),
      lastProgressAt: now.toISOString()
    },
    previousOffsets: { busy: 9_980 },
    currentOffsets: {},
    now,
    operationalFailure: false,
    cancelled: false
  })
  assert.equal(state.nextAttemptAt, null)
  assert.equal(state.failureCount, 0)
  assert.equal(state.paused, false)
  assert.equal(state.lastOutcome, 'drained')
  assert.equal(state.previousBacklogCount, 1)
  assert.equal(state.remainingBacklogCount, 0)
})

test('automatic continuation requires an enabled source, a due time and a live offset', () => {
  const state = {
    ...EMPTY_BACKLOG_RETRY_STATE,
    nextAttemptAt: '2026-07-31T01:59:00.000Z'
  }
  assert.equal(isBacklogRetryDue({ state, offsets: { busy: 9_980 }, sourceEnabled: true, now }), true)
  assert.equal(isBacklogRetryDue({ state, offsets: {}, sourceEnabled: true, now }), false)
  assert.equal(isBacklogRetryDue({ state, offsets: { busy: 9_980 }, sourceEnabled: false, now }), false)
  assert.equal(isBacklogRetryDue({
    state: { ...state, paused: true },
    offsets: { busy: 9_980 },
    sourceEnabled: true,
    now
  }), false)
  assert.equal(isBacklogRetryDue({
    state: { ...state, nextAttemptAt: '2026-07-31T02:01:00.000Z' },
    offsets: { busy: 9_980 },
    sourceEnabled: true,
    now
  }), false)
})
