import test from 'node:test'
import assert from 'node:assert/strict'
import {
  includeContinuationSessions,
  settleWithConcurrency
} from '../electron/services/sessionCollectionPolicy.ts'

test('persisted continuation sessions remain collectible outside the current session catalog', () => {
  const sessions = includeContinuationSessions(
    [{ username: 'visible', displayName: 'Visible', lastTimestamp: 20 }],
    { visible: 100, missing: 9_980, invalid: 0 },
    30
  )
  assert.equal(sessions.length, 2)
  assert.equal(sessions.filter(item => item.username === 'visible').length, 1)
  assert.deepEqual(sessions[1], {
    username: 'missing',
    displayName: 'missing',
    type: 'private',
    sessionType: 'private',
    lastTimestamp: 30,
    continuationRecovered: true
  })
})

test('recovered continuation preserves group session semantics', () => {
  const sessions = includeContinuationSessions([], { 'busy@chatroom': 19_960 }, 50)
  assert.equal(sessions[0].type, 'group')
  assert.equal(sessions[0].lastTimestamp, 50)
})

test('session collection preserves result order and never exceeds its concurrency budget', async () => {
  let active = 0
  let maxActive = 0
  const results = await settleWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (value) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, value % 2 ? 2 : 1))
    active -= 1
    if (value === 4) throw new Error('expected failure')
    return value * 10
  })
  assert.equal(maxActive, 3)
  assert.deepEqual(results.map(result =>
    result.status === 'fulfilled' ? result.value : 'failed'
  ), [0, 10, 20, 30, 'failed', 50])
})
