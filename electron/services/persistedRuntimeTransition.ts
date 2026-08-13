export function commitPersistedRuntimeTransition<T>(
  previous: T,
  next: T,
  apply: (value: T) => void,
  persist: () => void
): void {
  apply(next)
  try {
    persist()
  } catch (error) {
    apply(previous)
    throw error
  }
}
