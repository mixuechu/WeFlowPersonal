export type IncrementalSyncPhase = 'waiting_for_vector' | 'running'
export type BackgroundWriteConflict = 'incremental_sync' | 'vector_index' | 'search_repair'

export function getBackgroundWriteConflict(input: {
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
}): BackgroundWriteConflict | null {
  if (input.syncing) return 'incremental_sync'
  if (input.searchRepairing) return 'search_repair'
  if (input.vectorIndexing) return 'vector_index'
  return null
}

export function shouldDeferPreparedRecovery(input: {
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
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
