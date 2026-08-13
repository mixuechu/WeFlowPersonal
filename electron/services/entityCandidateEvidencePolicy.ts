export type EntityCandidateEvidence = {
  sourceId: string
  messageId: string
  sessionId: string
  timestamp: number
  sender: string
  excerpt: string
}

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function evidenceSourceId(message: any, evidenceKey: string): string {
  const explicit = compact(message?.sourceId, 120)
  if (explicit) return explicit
  const inferred = evidenceKey.match(/^([^:]+):/)?.[1] || ''
  return compact(inferred, 120) || 'legacy'
}

export function buildEntityCandidateEvidence(
  evidenceMessages: unknown,
  evidenceKeys: unknown
): EntityCandidateEvidence[] {
  const messages = Array.isArray(evidenceMessages) ? evidenceMessages : []
  const keys = Array.isArray(evidenceKeys) ? evidenceKeys.map(String) : []
  return messages.flatMap((message, index) => {
    const messageId = compact(keys[index], 1000)
    const excerpt = compact(message?.content, 500)
    if (!messageId || !excerpt) return []
    return [{
      sourceId: evidenceSourceId(message, messageId),
      messageId,
      sessionId: compact(message?.sessionId, 512),
      timestamp: Number.isFinite(Number(message?.timestamp)) ? Number(message.timestamp) : 0,
      sender: message?.direction === '我发送'
        ? '我'
        : compact(
          message?.senderName || message?.senderId || message?.sender ||
          message?.senderIdentity?.displayName,
          100
        ),
      excerpt
    }]
  })
}
