import test from 'node:test'
import assert from 'node:assert/strict'
import { BoundedStaleReloadTracker } from '../src/utils/boundedStaleReload.ts'

test('stale reload tracker stops the third repeated stale result', () => {
  const tracker = new BoundedStaleReloadTracker(3, 250)
  assert.deepEqual(tracker.next('claims', 'scope-a'), {
    retry: true, attempt: 1, delayMs: 250
  })
  assert.deepEqual(tracker.next('claims', 'scope-a'), {
    retry: true, attempt: 2, delayMs: 500
  })
  assert.deepEqual(tracker.next('claims', 'scope-a'), {
    retry: false, attempt: 3, delayMs: 0
  })
})

test('scope changes and successful reads reset stale history', () => {
  const tracker = new BoundedStaleReloadTracker()
  tracker.next('events', 'scope-a')
  assert.equal(tracker.next('events', 'scope-b').attempt, 1)
  tracker.next('events', 'scope-b')
  tracker.clear('events')
  assert.equal(tracker.next('events', 'scope-b').attempt, 1)
})

test('independent archives do not consume one another retry budgets', () => {
  const tracker = new BoundedStaleReloadTracker()
  tracker.next('claims', 'same-scope')
  tracker.next('claims', 'same-scope')
  assert.equal(tracker.next('tasks', 'same-scope').attempt, 1)
})
