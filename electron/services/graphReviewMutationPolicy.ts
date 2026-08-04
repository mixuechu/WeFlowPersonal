export function assertGraphReviewMutationRevision(
  expectedRevision: unknown,
  currentRevision: unknown
): void {
  const expected = String(expectedRevision || '').trim()
  const current = String(currentRevision || '').trim()
  if (!expected || !current || expected !== current) {
    throw new Error('图谱审阅队列在展示后发生了变化，请刷新后重新确认')
  }
}

export function runReversibleGraphMutation<TSnapshot, TResult>(input: {
  snapshot: TSnapshot
  apply: () => TResult
  transact: (apply: () => TResult) => TResult
  restore: (snapshot: TSnapshot) => void
  persistRestored: () => void
  onRollbackError?: (error: unknown) => void
}): TResult {
  try {
    return input.transact(input.apply)
  } catch (error) {
    input.restore(input.snapshot)
    try {
      input.persistRestored()
    } catch (rollbackError) {
      input.onRollbackError?.(rollbackError)
    }
    throw error
  }
}
