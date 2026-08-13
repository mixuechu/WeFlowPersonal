export type IncrementalSyncPhase = 'waiting_for_vector' | 'running'
export type BackgroundWriteConflict = 'incremental_sync' | 'vector_index' | 'search_repair' | 'resource_enrichment'

export type BackgroundWriteState = {
  active: boolean
  conflict: BackgroundWriteConflict | null
  syncing: boolean
  syncPhase: IncrementalSyncPhase | null
  vectorIndexing: boolean
  searchRepairing: boolean
  resourceEnriching: boolean
  message: string | null
}

export async function waitForBackgroundWrites(
  promises: Array<Promise<unknown> | null | undefined>
): Promise<{ waited: number; fulfilled: number; rejected: number }> {
  const unique = [...new Set(promises.filter(
    (promise): promise is Promise<unknown> => Boolean(promise)
  ))]
  const results = await Promise.allSettled(unique)
  return {
    waited: results.length,
    fulfilled: results.filter(result => result.status === 'fulfilled').length,
    rejected: results.filter(result => result.status === 'rejected').length
  }
}

export async function waitForNamedBackgroundWrites(
  entries: Array<{ name: string; promise: Promise<unknown> | null | undefined }>,
  timeoutMs: number
): Promise<{
  waited: number
  fulfilled: number
  rejected: number
  timedOut: boolean
  pending: string[]
}> {
  const byPromise = new Map<Promise<unknown>, Set<string>>()
  for (const entry of entries) {
    if (!entry.promise) continue
    const names = byPromise.get(entry.promise) || new Set<string>()
    names.add(entry.name)
    byPromise.set(entry.promise, names)
  }
  const pending = new Set([...byPromise.values()].flatMap(names => [...names]))
  let fulfilled = 0
  let rejected = 0
  const settled = [...byPromise.entries()].map(([promise, names]) =>
    promise.then(
      () => { fulfilled += 1 },
      () => { rejected += 1 }
    ).finally(() => {
      for (const name of names) pending.delete(name)
    })
  )
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timedOut = await Promise.race([
    Promise.all(settled).then(() => false),
    new Promise<boolean>(resolve => {
      timeout = setTimeout(() => resolve(true), Math.max(1, timeoutMs))
    })
  ])
  if (timeout) clearTimeout(timeout)
  return {
    waited: byPromise.size,
    fulfilled,
    rejected,
    timedOut,
    pending: [...pending].sort()
  }
}

export async function runAfterSettledBarrier<T>(
  barrier: Promise<unknown>,
  run: () => Promise<T>
): Promise<T> {
  await Promise.allSettled([barrier])
  return run()
}

export function describeBackgroundWriteState(input: {
  syncing: boolean
  syncPhase?: IncrementalSyncPhase | null
  vectorIndexing: boolean
  searchRepairing: boolean
  resourceEnriching?: boolean
}): BackgroundWriteState {
  const conflict = getBackgroundWriteConflict(input)
  const message = conflict === 'incremental_sync'
    ? input.syncPhase === 'waiting_for_vector'
      ? '增量处理正在等待当前语义索引批次结束'
      : '正在执行增量处理'
    : conflict === 'search_repair'
      ? '正在核验并修复检索索引'
      : conflict === 'resource_enrichment'
        ? '正在补齐图片、语音、附件或网页资源'
      : conflict === 'vector_index'
        ? '正在构建本地语义索引'
        : null
  return {
    active: conflict !== null,
    conflict,
    syncing: input.syncing,
    syncPhase: input.syncing ? input.syncPhase || 'running' : null,
    vectorIndexing: input.vectorIndexing,
    searchRepairing: input.searchRepairing,
    resourceEnriching: Boolean(input.resourceEnriching),
    message
  }
}

export function getVectorIndexWriteConflict(input: {
  syncing: boolean
  searchRepairing: boolean
  resourceEnriching?: boolean
}): Exclude<BackgroundWriteConflict, 'vector_index'> | null {
  if (input.syncing) return 'incremental_sync'
  if (input.searchRepairing) return 'search_repair'
  if (input.resourceEnriching) return 'resource_enrichment'
  return null
}

export function vectorIndexConflictMessage(
  conflict: Exclude<BackgroundWriteConflict, 'vector_index'>
): string {
  return conflict === 'incremental_sync'
    ? '当前正在增量处理，请在本轮结束后再补齐或重建语义索引'
    : conflict === 'search_repair'
      ? '当前正在核验并修复检索索引，请完成后再补齐或重建语义索引'
      : '当前正在补齐资源内容，请在本项完成后再补齐或重建语义索引'
}

export function getBackgroundWriteConflict(input: {
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
  resourceEnriching?: boolean
}): BackgroundWriteConflict | null {
  if (input.syncing) return 'incremental_sync'
  if (input.searchRepairing) return 'search_repair'
  if (input.resourceEnriching) return 'resource_enrichment'
  if (input.vectorIndexing) return 'vector_index'
  return null
}

export function shouldDeferPreparedRecovery(input: {
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
  resourceEnriching?: boolean
}): boolean {
  return getBackgroundWriteConflict(input) !== null
}

export function preparedRecoveryConflictMessage(
  conflict: BackgroundWriteConflict,
  queueLabel = '恢复队列'
): string {
  if (conflict === 'incremental_sync') {
    return `当前正在增量处理，请在本轮结束后重试${queueLabel}`
  }
  if (conflict === 'search_repair') {
    return `当前正在核验检索索引，请在完成后重试${queueLabel}`
  }
  if (conflict === 'resource_enrichment') {
    return `当前正在补齐资源内容，请在本项完成后重试${queueLabel}`
  }
  return `当前正在构建本地向量索引，请在当前批次完成后重试${queueLabel}`
}

export async function runAfterVectorBarrier<T>(input: {
  barrier: Promise<unknown> | null
  setPhase: (phase: IncrementalSyncPhase) => void
  onBarrierError?: (error: unknown) => void
  run: () => Promise<T>
}): Promise<T> {
  if (input.barrier) {
    input.setPhase('waiting_for_vector')
    try {
      await input.barrier
    } catch (error) {
      input.onBarrierError?.(error)
    }
  }
  input.setPhase('running')
  return input.run()
}
