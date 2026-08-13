export type StableCursorPage<T> = {
  items: T[]
  total: number
  hasMore: boolean
  nextCursor: string
}

export function paginateByStableStringCursor<T>(
  values: T[],
  options: {
    key: (value: T) => string
    cursor?: string
    limit?: number
  }
): StableCursorPage<T> {
  const key = options.key
  const cursor = String(options.cursor || '')
  const limit = Math.max(1, Math.min(10_000, Math.floor(Number(options.limit) || 100)))
  const unique = new Map<string, T>()
  for (const value of values) {
    const valueKey = String(key(value) || '').trim()
    if (valueKey) unique.set(valueKey, value)
  }
  const sorted = [...unique.values()].sort((left, right) => {
    const leftKey = key(left)
    const rightKey = key(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  const eligible = cursor ? sorted.filter(value => key(value) > cursor) : sorted
  const items = eligible.slice(0, limit)
  const hasMore = eligible.length > items.length
  return {
    items,
    total: sorted.length,
    hasMore,
    nextCursor: hasMore && items.length ? key(items[items.length - 1]) : ''
  }
}

export async function collectStableCursorPages<T>(
  fetchPage: (cursor: string) => Promise<StableCursorPage<T>>,
  key: (value: T) => string
): Promise<T[]> {
  const items = new Map<string, T>()
  const seenCursors = new Set<string>()
  let cursor = ''
  while (true) {
    const page = await fetchPage(cursor)
    for (const item of page.items || []) {
      const itemKey = String(key(item) || '').trim()
      if (itemKey) items.set(itemKey, item)
    }
    if (!page.hasMore) break
    const nextCursor = String(page.nextCursor || '').trim()
    if (!nextCursor || nextCursor <= cursor || seenCursors.has(nextCursor)) {
      throw new Error('稳定游标分页未向前推进')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  return [...items.values()]
}
