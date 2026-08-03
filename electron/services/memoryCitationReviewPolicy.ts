import { createHash } from 'crypto'

export type MemoryCitationReviewIdentity = {
  assistantMessageId: string
  documentId: string
  documentType: string
  sourceId: string
  contentHash: string
  status: string
  evidenceTotal: number
  evidenceKeys: string[]
  scopeFingerprint: string
}

const normalizeEvidenceKey = (item: any): string => [
  String(item?.source_id || item?.sourceId || '').trim(),
  String(item?.session_id || item?.sessionId || '').trim(),
  String(item?.message_id || item?.messageId || '').trim(),
  String(item?.evidence_role || item?.evidenceRole || '').trim(),
  String(item?.timestamp || '').trim(),
  String(item?.sender || '').trim(),
  createHash('sha256').update(String(item?.excerpt || '')).digest('hex')
].join('\u001f')

export const buildMemoryCitationReviewIdentity = (input: {
  assistantMessageId: string
  document: any
  scopeFingerprint?: string
}): MemoryCitationReviewIdentity => ({
  assistantMessageId: String(input.assistantMessageId || '').trim(),
  documentId: String(input.document?.id || '').trim(),
  documentType: String(input.document?.document_type || '').trim(),
  sourceId: String(input.document?.source_id || '').trim(),
  contentHash: String(input.document?.content_hash || '').trim().toLowerCase(),
  status: String(input.document?.status || input.document?.metadata?.status || '').trim(),
  evidenceTotal: Math.max(
    Array.isArray(input.document?.evidence) ? input.document.evidence.length : 0,
    Number(input.document?.evidenceTotal || 0)
  ),
  evidenceKeys: [...new Set((Array.isArray(input.document?.evidence) ? input.document.evidence : [])
    .map(normalizeEvidenceKey)
    .filter(Boolean))].sort(),
  scopeFingerprint: String(input.scopeFingerprint || 'unscoped').trim()
})

export const buildMemoryCitationReviewToken = (identity: MemoryCitationReviewIdentity): string =>
  createHash('sha256').update(JSON.stringify(identity)).digest('hex')

export const assertMemoryCitationReviewToken = (
  identity: MemoryCitationReviewIdentity,
  token: unknown
): void => {
  const expected = buildMemoryCitationReviewToken(identity)
  const provided = String(token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided) || provided !== expected) {
    throw new Error('这条引用的正文、状态、证据或检索范围已经变化，请刷新回答后再审阅')
  }
}
