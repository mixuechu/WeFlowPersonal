import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncExpiringValue } from '../electron/services/asyncExpiringValue.ts'

test('expiring async values reuse fresh results and refresh after the TTL', async () => {
  let now = 1_000
  let calls = 0
  const cache = new AsyncExpiringValue(300, () => now)
  const loader = async () => ({ generation: ++calls })

  assert.deepEqual(await cache.get(loader), { generation: 1 })
  now += 299
  assert.deepEqual(await cache.get(loader), { generation: 1 })
  assert.equal(calls, 1)

  now += 1
  assert.deepEqual(await cache.get(loader), { generation: 2 })
  assert.equal(calls, 2)
})

test('expiring async values coalesce concurrent refreshes and recover after failure', async () => {
  let resolve!: (value: string) => void
  let calls = 0
  const cache = new AsyncExpiringValue<string>(0)
  const pending = () => {
    calls += 1
    return new Promise<string>(next => { resolve = next })
  }
  const first = cache.get(pending)
  const second = cache.get(pending)
  assert.equal(calls, 1)
  resolve('ready')
  assert.equal(await first, 'ready')
  assert.equal(await second, 'ready')

  await assert.rejects(cache.get(async () => {
    calls += 1
    throw new Error('temporary')
  }, true), /temporary/)
  assert.equal(await cache.get(async () => {
    calls += 1
    return 'recovered'
  }, true), 'recovered')
  assert.equal(calls, 3)
})

test('explicit values and invalidation update authorization snapshots immediately', async () => {
  let now = 10
  let calls = 0
  const cache = new AsyncExpiringValue(1_000, () => now)
  cache.set({ calendar: 'authorized', mail: 'denied' })
  assert.deepEqual(cache.peek(), { calendar: 'authorized', mail: 'denied' })
  assert.deepEqual(await cache.get(async () => {
    calls += 1
    return { calendar: 'denied', mail: 'authorized' }
  }), { calendar: 'authorized', mail: 'denied' })
  assert.equal(calls, 0)

  cache.invalidate()
  now += 1
  assert.deepEqual(await cache.get(async () => {
    calls += 1
    return { calendar: 'denied', mail: 'authorized' }
  }), { calendar: 'denied', mail: 'authorized' })
  assert.equal(calls, 1)
})
