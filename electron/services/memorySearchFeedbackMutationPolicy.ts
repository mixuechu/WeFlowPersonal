import crypto from 'node:crypto'

export function buildMemorySearchFeedbackMutationToken(input: {
  queryFingerprint: string
  scopeFingerprint: string
  documentId: string
  documentType: string
  sourceId: string
  contentHash: string
  evidenceAuthorityRevision: number
  currentAction: string
}): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    'memory-search-feedback-mutation-v1',
    String(input.queryFingerprint || ''),
    String(input.scopeFingerprint || ''),
    String(input.documentId || ''),
    String(input.documentType || ''),
    String(input.sourceId || ''),
    String(input.contentHash || ''),
    Math.max(0, Math.floor(Number(input.evidenceAuthorityRevision) || 0)),
    String(input.currentAction || '')
  ])).digest('hex')
}
