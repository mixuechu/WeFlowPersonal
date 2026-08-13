import test from 'node:test'
import assert from 'node:assert/strict'
import { TrailingCoalescedRequest } from '../src/utils/trailingCoalescedRequest.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

test('bursty refreshes keep one request active and retain only one latest trailing run', async () => {
  const coordinator = new TrailingCoalescedRequest<string>()
  const first = deferred<string>()
  const trailing = deferred<string>()
  let active = 0
  let maximumActive = 0
  let calls = 0
  const work = (gate: ReturnType<typeof deferred<string>>, value: string) => async () => {
    calls += 1
    active += 1
    maximumActive = Math.max(maximumActive, active)
    try {
      await gate.promise
      return value
    } finally {
      active -= 1
    }
  }

  const original = coordinator.run(work(first, 'first'))
  const superseded = coordinator.run(work(trailing, 'second'))
  const latest = coordinator.run(work(trailing, 'latest'))
  assert.equal(original, superseded)
  assert.equal(original, latest)
  assert.equal(calls, 1)

  first.resolve('done')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  assert.equal(maximumActive, 1)
  trailing.resolve('done')
  assert.equal(await latest, 'latest')
})

test('a queued trailing refresh recovers from an earlier failure', async () => {
  const coordinator = new TrailingCoalescedRequest<number>()
  const first = deferred<number>()
  const result = coordinator.run(async () => {
    await first.promise
    return 1
  })
  coordinator.run(async () => 2)
  first.reject(new Error('temporary failure'))
  assert.equal(await result, 2)
  assert.equal(await coordinator.run(async () => 3), 3)
})

test('an unqueued failure rejects and leaves the coordinator reusable', async () => {
  const coordinator = new TrailingCoalescedRequest<number>()
  await assert.rejects(coordinator.run(async () => {
    throw new Error('offline')
  }), /offline/)
  assert.equal(await coordinator.run(async () => 4), 4)
})

test('even an undefined rejection remains a rejection', async () => {
  const coordinator = new TrailingCoalescedRequest<number>()
  await assert.rejects(coordinator.run(async () => Promise.reject(undefined)))
})
