import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeBackgroundWriteState,
  getBackgroundWriteConflict,
  getVectorIndexWriteConflict,
  preparedRecoveryConflictMessage,
  runAfterVectorBarrier,
  shouldDeferPreparedRecovery,
  waitForBackgroundWrites,
  vectorIndexConflictMessage
} from '../electron/services/backgroundWriteCoordination.ts'

test('shutdown barrier waits for every unique writer and contains rejected work', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let completed = false
  const barrier = waitForBackgroundWrites([
    pending,
    pending,
    Promise.reject(new Error('expected writer failure')),
    null
  ]).then(result => {
    completed = true
    return result
  })

  await Promise.resolve()
  assert.equal(completed, false)
  release?.()
  assert.deepEqual(await barrier, {
    waited: 2,
    fulfilled: 1,
    rejected: 1
  })
})

test('background writer diagnostics expose the authoritative owner and waiting phase', () => {
  assert.deepEqual(describeBackgroundWriteState({
    syncing: false,
    vectorIndexing: false,
    searchRepairing: false
  }), {
    active: false,
    conflict: null,
    syncing: false,
    syncPhase: null,
    vectorIndexing: false,
    searchRepairing: false,
    message: null
  })

  assert.deepEqual(describeBackgroundWriteState({
    syncing: true,
    syncPhase: 'waiting_for_vector',
    vectorIndexing: true,
    searchRepairing: false
  }), {
    active: true,
    conflict: 'incremental_sync',
    syncing: true,
    syncPhase: 'waiting_for_vector',
    vectorIndexing: true,
    searchRepairing: false,
    message: '增量处理正在等待当前语义索引批次结束'
  })

  assert.equal(describeBackgroundWriteState({
    syncing: false,
    vectorIndexing: true,
    searchRepairing: true
  }).message, '正在核验并修复检索索引')
})

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

test('manual recovery reports the exact writer that owns the gate', () => {
  assert.equal(getBackgroundWriteConflict({
    syncing: false, vectorIndexing: false, searchRepairing: false
  }), null)
  assert.equal(getBackgroundWriteConflict({
    syncing: true, vectorIndexing: true, searchRepairing: true
  }), 'incremental_sync')
  assert.equal(getBackgroundWriteConflict({
    syncing: false, vectorIndexing: true, searchRepairing: true
  }), 'search_repair')
  assert.equal(getBackgroundWriteConflict({
    syncing: false, vectorIndexing: true, searchRepairing: false
  }), 'vector_index')
  assert.match(preparedRecoveryConflictMessage('incremental_sync'), /增量处理/)
  assert.match(preparedRecoveryConflictMessage('search_repair'), /检索索引/)
  assert.match(
    preparedRecoveryConflictMessage('vector_index', '写入恢复队列'),
    /本地向量索引.*写入恢复队列/
  )
})

test('manual vector indexing rejects both authoritative writers with a specific reason', () => {
  assert.equal(getVectorIndexWriteConflict({
    syncing: false,
    searchRepairing: false
  }), null)
  assert.equal(getVectorIndexWriteConflict({
    syncing: true,
    searchRepairing: true
  }), 'incremental_sync')
  assert.equal(getVectorIndexWriteConflict({
    syncing: false,
    searchRepairing: true
  }), 'search_repair')
  assert.match(vectorIndexConflictMessage('incremental_sync'), /增量处理.*语义索引/)
  assert.match(vectorIndexConflictMessage('search_repair'), /核验并修复检索索引.*语义索引/)
})
