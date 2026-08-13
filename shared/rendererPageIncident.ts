export const RENDERER_PAGE_INCIDENT_VERSION = 'renderer-page-incident-v1' as const

const PAGE_KINDS = new Set([
  'home', 'account_management', 'chat', 'analytics', 'annual_report', 'dual_report',
  'footprint', 'export', 'sns', 'insight_inbox', 'ai_assistant', 'biz', 'contacts',
  'resources', 'backup', 'chat_history', 'settings', 'other'
])

const ERROR_CLASSES = new Set([
  'ChunkLoadError', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'Error', 'UnknownError'
])

export type RendererPageIncidentPayload = {
  version: typeof RENDERER_PAGE_INCIDENT_VERSION
  pageKind: string
  errorClass: string
  fingerprint: string
}

export const rendererPageKind = (pathname: unknown): string => {
  const segment = String(pathname || '').trim().split('/').filter(Boolean)[0] || 'home'
  const normalized = segment.replace(/-/g, '_')
  return PAGE_KINDS.has(normalized) ? normalized : 'other'
}

const rendererErrorClass = (error: unknown): string => {
  const candidate = error && typeof error === 'object'
    ? String((error as { name?: unknown }).name || '')
    : ''
  const message = error && typeof error === 'object'
    ? String((error as { message?: unknown }).message || '')
    : String(error || '')
  if (/dynamically imported module|loading chunk|chunkloaderror/i.test(message)) return 'ChunkLoadError'
  return ERROR_CLASSES.has(candidate) ? candidate : candidate ? 'Error' : 'UnknownError'
}

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const buildRendererPageIncident = async (
  pathname: unknown,
  error: unknown,
  componentStack: unknown
): Promise<RendererPageIncidentPayload> => {
  const errorName = error && typeof error === 'object'
    ? String((error as { name?: unknown }).name || '')
    : ''
  const errorMessage = error && typeof error === 'object'
    ? String((error as { message?: unknown }).message || '')
    : String(error || '')
  const fingerprint = await sha256([
    errorName.slice(0, 80),
    errorMessage.slice(0, 4_000),
    String(componentStack || '').slice(0, 12_000)
  ].join('\n'))
  return {
    version: RENDERER_PAGE_INCIDENT_VERSION,
    pageKind: rendererPageKind(pathname),
    errorClass: rendererErrorClass(error),
    fingerprint: fingerprint.slice(0, 24)
  }
}

export const normalizeRendererPageIncident = (
  value: unknown
): RendererPageIncidentPayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== RENDERER_PAGE_INCIDENT_VERSION) return null
  const pageKind = String(raw.pageKind || '')
  const errorClass = String(raw.errorClass || '')
  const fingerprint = String(raw.fingerprint || '').toLowerCase()
  if (!PAGE_KINDS.has(pageKind) || !ERROR_CLASSES.has(errorClass) || !/^[a-f0-9]{24}$/.test(fingerprint)) {
    return null
  }
  return { version: RENDERER_PAGE_INCIDENT_VERSION, pageKind, errorClass, fingerprint }
}
