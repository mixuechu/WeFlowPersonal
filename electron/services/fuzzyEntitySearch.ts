export function normalizeEntityTerm(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/[\s_\-—·.]+/g, '')
}

export function editDistance(leftValue: string, rightValue: string): number {
  const left = [...normalizeEntityTerm(leftValue)]
  const right = [...normalizeEntityTerm(rightValue)]
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = [0, ...right.map((_, index) => index + 1)]
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[right.length]
}

export function fuzzyEntityScore(query: string, terms: string[]): number | null {
  const normalizedQuery = normalizeEntityTerm(query)
  if (normalizedQuery.length < 2 || normalizedQuery.length > 32 || /\s/.test(query.trim())) return null
  let best = Number.POSITIVE_INFINITY
  for (const term of terms) {
    const normalizedTerm = normalizeEntityTerm(term)
    if (normalizedTerm.length < 2) continue
    if (normalizedTerm.includes(normalizedQuery) || normalizedQuery.includes(normalizedTerm)) return 0
    const distance = editDistance(normalizedQuery, normalizedTerm)
    const allowed = normalizedQuery.length <= 4 ? 1 : Math.min(3, Math.floor(normalizedQuery.length * 0.25))
    if (distance <= allowed) best = Math.min(best, distance / Math.max(normalizedQuery.length, normalizedTerm.length))
  }
  return Number.isFinite(best) ? best : null
}
