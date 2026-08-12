import crypto from 'node:crypto'

export type MemoryEvidenceArchiveScopeInput = {
  query?: unknown
  source?: unknown
  session?: unknown
  sender?: unknown
  role?: unknown
  fromTimestamp?: unknown
  toTimestamp?: unknown
}

export type NormalizedMemoryEvidenceArchiveScope = {
  query: string
  source: string
  session: string
  sender: string
  role: '' | 'direct' | 'indirect' | 'contradiction' | 'support' | 'original'
  fromTimestamp: number
  toTimestamp: number
}

const EVIDENCE_ROLES = new Set([
  'direct', 'indirect', 'contradiction', 'support', 'original'
])

function normalizedTimestamp(value: unknown): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
}

export function normalizeMemoryEvidenceArchiveScope(
  input: MemoryEvidenceArchiveScopeInput = {}
): NormalizedMemoryEvidenceArchiveScope {
  const requestedRole = String(input.role || '').trim().toLowerCase()
  return {
    query: String(input.query || '').trim().slice(0, 500),
    source: String(input.source || '').trim().toLowerCase().slice(0, 100),
    session: String(input.session || '').trim().slice(0, 500),
    sender: String(input.sender || '').trim().slice(0, 200),
    role: EVIDENCE_ROLES.has(requestedRole)
      ? requestedRole as NormalizedMemoryEvidenceArchiveScope['role']
      : '',
    fromTimestamp: normalizedTimestamp(input.fromTimestamp),
    toTimestamp: normalizedTimestamp(input.toTimestamp)
  }
}

export function buildMemoryEvidenceArchiveScopeToken(
  archiveKind: 'memory' | 'graph_review',
  documentType: string,
  sourceId: string,
  input: MemoryEvidenceArchiveScopeInput = {}
): { token: string; scope: NormalizedMemoryEvidenceArchiveScope } {
  const scope = normalizeMemoryEvidenceArchiveScope(input)
  const token = crypto.createHash('sha256').update(JSON.stringify([
    'memory-evidence-archive-scope-v1',
    archiveKind,
    String(documentType || '').trim(),
    String(sourceId || '').trim(),
    scope
  ])).digest('hex')
  return { token, scope }
}
