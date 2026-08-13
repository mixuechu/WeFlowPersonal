import test from 'node:test'
import assert from 'node:assert/strict'
import { SerialWorkerRequestQueue } from '../electron/services/serialWorkerRequestQueue.ts'

test('worker request queue never overlaps native operations and preserves arrival order', async () => {
  const queue = new SerialWorkerRequestQueue()
  const order: string[] = []
  let active = 0
  let releaseFirst!: () => void
  const firstBarrier = new Promise<void>(resolve => { releaseFirst = resolve })

  const first = queue.enqueue(async () => {
    active += 1
    assert.equal(active, 1)
    order.push('first:start')
    await firstBarrier
    order.push('first:end')
    active -= 1
    return 'first'
  })
  const close = queue.enqueue(async () => {
    active += 1
    assert.equal(active, 1)
    order.push('close')
    active -= 1
    return 'closed'
  })

  await Promise.resolve()
  assert.deepEqual(order, ['first:start'])
  releaseFirst()
  assert.equal(await first, 'first')
  assert.equal(await close, 'closed')
  assert.deepEqual(order, ['first:start', 'first:end', 'close'])
})

test('one failed worker request does not poison the following close request', async () => {
  const queue = new SerialWorkerRequestQueue()
  await assert.rejects(queue.enqueue(async () => {
    throw new Error('fixture failure')
  }), /fixture failure/)
  assert.equal(await queue.enqueue(() => 'closed'), 'closed')
})
