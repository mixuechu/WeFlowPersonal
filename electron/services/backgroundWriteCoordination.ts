export type IncrementalSyncPhase = 'waiting_for_vector' | 'running'

export function shouldDeferPreparedRecovery(input: {
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
}): boolean {
  return input.syncing || input.vectorIndexing || input.searchRepairing
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
