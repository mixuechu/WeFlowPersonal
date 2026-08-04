export function setKeyedLoadingState(
  current: Record<string, boolean>,
  key: string,
  loading: boolean
): Record<string, boolean> {
  if (loading) return current[key] ? current : { ...current, [key]: true }
  if (!current[key]) return current
  const next = { ...current }
  delete next[key]
  return next
}
