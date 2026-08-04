import assert from 'node:assert/strict'
import test from 'node:test'
import {
  runAfterVectorBarrier,
  shouldDeferPreparedRecovery
} from '../electron/services/backgroundWriteCoordination.ts'

test('incremental sync waits for an already-running vector batch', async () => {
  let releaseBarrier!: () => void
  const barrier = new Promise<void>(resolve => {
    releaseBarrier = resolve
  })
  const phases: string[] = []
  let ran = false
  const pending = runAfterVectorBarrier({
    barrier,
    setPhase: phase => phases.push(phase),
    run: async () => {
      ran = true
      return 'done'
    }
  })

  await Promise.resolve()
  assert.equal(ran, false)
  assert.deepEqual(phases, ['waiting_for_vector'])
  releaseBarrier()
  assert.equal(await pending, 'done')
  assert.equal(ran, true)
  assert.deepEqual(phases, ['waiting_for_vector', 'running'])
})

test('failed maintenance vector batch does not block authoritative incremental sync', async () => {
  const errors: unknown[] = []
  const phases: string[] = []
  const result = await runAfterVectorBarrier({
    barrier: Promise.reject(new Error('maintenance failed')),
    setPhase: phase => phases.push(phase),
    onBarrierError: error => errors.push(error),
    run: async () => 'synced'
  })

  assert.equal(result, 'synced')
  assert.equal(errors.length, 1)
  assert.deepEqual(phases, ['waiting_for_vector', 'running'])
})

test('prepared recovery defers for every background writer', () => {
  assert.equal(shouldDeferPreparedRecovery({
    syncing: false, vectorIndexing: false, searchRepairing: false
  }), false)
  assert.equal(shouldDeferPreparedRecovery({
    syncing: true, vectorIndexing: false, searchRepairing: false
  }), true)
  assert.equal(shouldDeferPreparedRecovery({
    syncing: false, vectorIndexing: true, searchRepairing: false
  }), true)
  assert.equal(shouldDeferPreparedRecovery({
    syncing: false, vectorIndexing: false, searchRepairing: true
  }), true)
})
