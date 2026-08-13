import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeBackgroundWriteState,
  getBackgroundWriteConflict,
  getVectorIndexWriteConflict,
  preparedRecoveryConflictMessage,
  runAfterSettledBarrier,
  runAfterVectorBarrier,
  shouldDeferPreparedRecovery,
  waitForBackgroundWrites,
  waitForNamedBackgroundWrites,
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

test('shutdown barrier also waits for ancillary scheduler and notification work', async () => {
  const releases: Array<() => void> = []
  const makePending = () => new Promise<void>(resolve => { releases.push(resolve) })
  const writers = [makePending(), makePending(), makePending(), makePending(), makePending()]
  let completed = false
  const barrier = waitForBackgroundWrites(writers).then(result => {
    completed = true
    return result
  })

  releases.slice(0, 4).forEach(release => release())
  await Promise.resolve()
  assert.equal(completed, false)
  releases[4]()
  assert.deepEqual(await barrier, {
    waited: 5,
    fulfilled: 5,
    rejected: 0
  })
})

test('resume work runs after an existing scheduler tick even when that tick fails', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const timerTick = new Promise<void>((_resolve, reject) => {
    release = () => {
      order.push('timer')
      reject(new Error('expected timer failure'))
    }
  })
  const resume = runAfterSettledBarrier(timerTick, async () => {
    order.push('resume')
    return 'resume_completed'
  })

  await Promise.resolve()
  assert.deepEqual(order, [])
  release?.()
  assert.equal(await resume, 'resume_completed')
  assert.deepEqual(order, ['timer', 'resume'])
})

test('bounded shutdown identifies unfinished writers without closing over their failure', async () => {
  let release: (() => void) | undefined
  const stuck = new Promise<void>(resolve => { release = resolve })
  const shared = Promise.resolve()
  const result = await waitForNamedBackgroundWrites([
    { name: 'incremental_sync', promise: stuck },
    { name: 'scheduler_tick', promise: stuck },
    { name: 'notification_flush', promise: shared },
    { name: 'duplicate_notification', promise: shared }
  ], 5)
  assert.deepEqual(result, {
    waited: 2,
    fulfilled: 1,
    rejected: 0,
    timedOut: true,
    pending: ['incremental_sync', 'scheduler_tick']
  })
  release?.()
})

test('bounded shutdown reports rejection but still completes when every writer settles', async () => {
  const result = await waitForNamedBackgroundWrites([
    { name: 'sync', promise: Promise.resolve() },
    { name: 'repair', promise: Promise.reject(new Error('expected')) }
  ], 100)
  assert.deepEqual(result, {
    waited: 2,
    fulfilled: 1,
    rejected: 1,
    timedOut: false,
    pending: []
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
    resourceEnriching: false,
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
    resourceEnriching: false,
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
  assert.equal(shouldDeferPreparedRecovery({
    syncing: false, vectorIndexing: false, searchRepairing: false, resourceEnriching: true
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
  assert.equal(getBackgroundWriteConflict({
    syncing: false, vectorIndexing: false, searchRepairing: false, resourceEnriching: true
  }), 'resource_enrichment')
  assert.match(preparedRecoveryConflictMessage('incremental_sync'), /增量处理/)
  assert.match(preparedRecoveryConflictMessage('search_repair'), /检索索引/)
  assert.match(
    preparedRecoveryConflictMessage('vector_index', '写入恢复队列'),
    /本地向量索引.*写入恢复队列/
  )
  assert.match(preparedRecoveryConflictMessage('resource_enrichment'), /资源内容/)
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
  assert.equal(getVectorIndexWriteConflict({
    syncing: false,
    searchRepairing: false,
    resourceEnriching: true
  }), 'resource_enrichment')
  assert.match(vectorIndexConflictMessage('incremental_sync'), /增量处理.*语义索引/)
  assert.match(vectorIndexConflictMessage('search_repair'), /核验并修复检索索引.*语义索引/)
})
