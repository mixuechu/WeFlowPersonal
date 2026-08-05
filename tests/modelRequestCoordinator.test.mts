import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelRequestCoordinator } from '../electron/services/modelRequestCoordinator.ts'

test('model request coordinator aborts active requests and rejects new work after stop', async () => {
  const coordinator = new ModelRequestCoordinator((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  const request = coordinator.fetch('https://example.invalid/model')
  await Promise.resolve()
  assert.deepEqual(coordinator.getStatus(), { accepting: true, active: 1 })
  assert.equal(coordinator.stop('test shutdown'), 1)
  await assert.rejects(request, /test shutdown/)
  assert.deepEqual(coordinator.getStatus(), { accepting: false, active: 0 })
  await assert.rejects(
    coordinator.fetch('https://example.invalid/model'),
    /正在安全退出/
  )
})

test('model request coordinator enforces its own bounded deadline', async () => {
  const coordinator = new ModelRequestCoordinator((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  await assert.rejects(
    coordinator.fetch('https://example.invalid/model', {}, 5),
    /超过 1 秒/
  )
  assert.equal(coordinator.getStatus().active, 0)
})
