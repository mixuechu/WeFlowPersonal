export type ShanghaiDateBoundary = {
  state: 'empty' | 'valid' | 'invalid'
  milliseconds: number | null
  seconds: number | null
  iso: string | null
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}

/** Parse a renderer date input as one Asia/Shanghai boundary without rollover. */
export function parseShanghaiDateBoundary(
  value: unknown,
  endOfDay = false
): ShanghaiDateBoundary {
  const text = String(value || '').trim()
  if (!text) return { state: 'empty', milliseconds: null, seconds: null, iso: null }
  const datePrefix = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(text)?.[1]
  if (datePrefix && !isValidCalendarDate(datePrefix)) {
    return { state: 'invalid', milliseconds: null, seconds: null, iso: null }
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
  if (!dateOnly && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    return { state: 'invalid', milliseconds: null, seconds: null, iso: null }
  }
  const normalized = dateOnly
    ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`
    : text
  const milliseconds = Date.parse(normalized)
  if (!Number.isFinite(milliseconds)) {
    return { state: 'invalid', milliseconds: null, seconds: null, iso: null }
  }
  return {
    state: 'valid',
    milliseconds,
    seconds: Math.floor(milliseconds / 1000),
    iso: new Date(milliseconds).toISOString()
  }
}
