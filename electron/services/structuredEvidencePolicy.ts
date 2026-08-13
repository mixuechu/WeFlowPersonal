export type StructuredEvidenceValidation = {
  digest: any
  accepted: Record<string, number>
  rejected: Record<string, number>
}

export function structuredEvidenceKey(message: any): string {
  return `${message?.sourceId || 'wechat'}:${message?.sessionId || ''}:${message?.id || ''}`
}

export function buildStructuredExtractionEvidence(
  message: any,
  excerpt: string,
  role?: 'direct' | 'indirect' | 'contradiction'
): {
  sourceId: string
  messageId: string
  sessionId: string
  timestamp: number
  sender: string
  excerpt: string
  role?: 'direct' | 'indirect' | 'contradiction'
} {
  const evidence = {
    sourceId: String(message?.sourceId || 'wechat'),
    messageId: structuredEvidenceKey(message),
    sessionId: String(message?.sessionId || ''),
    timestamp: Number(message?.timestamp || 0),
    sender: message?.direction === '我发送'
      ? '我'
      : String(message?.senderName || message?.senderId || ''),
    excerpt: String(excerpt || '')
  }
  return role ? { ...evidence, role } : evidence
}

function validateItems(
  value: unknown,
  evidenceField: string,
  coreMessages: Map<string, any>
): { items: any[]; rejected: number } {
  const source = Array.isArray(value) ? value : []
  const items = source.flatMap((item: any) => {
    const requested = Array.isArray(item?.[evidenceField])
      ? [...new Set(item[evidenceField].map(String))].slice(0, 20)
      : []
    const evidenceMessages = requested.flatMap(key => {
      const message = coreMessages.get(key)
      return message ? [message] : []
    })
    if (!evidenceMessages.length) return []
    return [{
      ...item,
      [evidenceField]: evidenceMessages.map(structuredEvidenceKey),
      __evidenceMessages: evidenceMessages
    }]
  })
  return { items, rejected: source.length - items.length }
}

/**
 * Treat model-provided references as untrusted input. Every structure must
 * point to at least one real core message in the exact batch, using a
 * cross-source/session/message composite key. This runs before any graph or
 * database mutation.
 */
export function validateStructuredDigestEvidence(digest: any, batch: any[]): StructuredEvidenceValidation {
  const coreMessages = new Map((batch || [])
    .filter(message => (message.analysisScope || 'core') === 'core')
    .map(message => [structuredEvidenceKey(message), message]))
  const fields = {
    tasks: 'sourceEvidenceKeys',
    entities: 'evidenceKeys',
    relations: 'evidenceKeys',
    claims: 'evidenceKeys',
    events: 'evidenceKeys',
    possibleDuplicates: 'evidenceKeys'
  } as const
  const accepted: Record<string, number> = {}
  const rejected: Record<string, number> = {}
  const validated: Record<string, any[]> = {}
  for (const [name, evidenceField] of Object.entries(fields)) {
    const result = validateItems(digest?.[name], evidenceField, coreMessages)
    validated[name] = result.items
    accepted[name] = result.items.length
    rejected[name] = result.rejected
  }
  return {
    digest: { ...digest, ...validated },
    accepted,
    rejected
  }
}
