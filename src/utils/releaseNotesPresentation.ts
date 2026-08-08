export const MAX_RELEASE_NOTES_TEXT_LENGTH = 12_000

const decodeHtmlEntity = (entity: string): string => {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  }
  const normalized = entity.toLowerCase()
  if (named[normalized] !== undefined) return named[normalized]
  const numeric = normalized.startsWith('#x')
    ? Number.parseInt(normalized.slice(2), 16)
    : (normalized.startsWith('#') ? Number.parseInt(normalized.slice(1), 10) : Number.NaN)
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return `&${entity};`
  try {
    return String.fromCodePoint(numeric)
  } catch {
    return `&${entity};`
  }
}

export const releaseNotesToSafeText = (raw: unknown): string => {
  const source = String(raw || '').slice(0, MAX_RELEASE_NOTES_TEXT_LENGTH * 4)
  const text = source
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-zA-Z]+|#\d+|#x[\da-fA-F]+);/g, (_match, entity: string) => decodeHtmlEntity(entity))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length <= MAX_RELEASE_NOTES_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_RELEASE_NOTES_TEXT_LENGTH - 1).trimEnd()}…`
}
