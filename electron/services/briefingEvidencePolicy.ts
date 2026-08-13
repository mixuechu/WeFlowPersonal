export type GroundedBriefingEvidence = {
  evidenceKey: string
  sourceId: string
  messageId: string
  sessionId: string
  sessionName: string
  timestamp: number
  sender: string
  excerpt: string
}

export type GroundedBriefingHighlight = {
  text: string
  sourceEvidenceKeys: string[]
  evidence: GroundedBriefingEvidence[]
}

function evidenceKey(message: any): string {
  return `${message?.sourceId || 'wechat'}:${message?.sessionId || ''}:${message?.id || ''}`
}

function evidenceFor(keys: unknown, messages: Map<string, any>): GroundedBriefingEvidence[] {
  if (!Array.isArray(keys)) return []
  const unique = [...new Set(keys.map(String))].slice(0, 20)
  return unique.flatMap(key => {
    const message = messages.get(key)
    if (!message) return []
    return [{
      evidenceKey: key,
      sourceId: String(message.sourceId || 'wechat'),
      messageId: String(message.id || ''),
      sessionId: String(message.sessionId || ''),
      sessionName: String(message.sessionName || ''),
      timestamp: Number(message.timestamp || 0),
      sender: message.direction === '我发送'
        ? '我'
        : String(message.senderName || message.senderId || '对方'),
      excerpt: String(message.content || '').slice(0, 500)
    }]
  })
}

/**
 * Summaries and highlights are model-written prose, so they are accepted only
 * when the model points at a real core message in the exact analysis batch.
 * Context-overlap messages cannot independently create a repeated briefing.
 */
export function groundBriefingDigest(digest: any, batch: any[]): {
  summary: string
  summaryEvidence: GroundedBriefingEvidence[]
  highlights: GroundedBriefingHighlight[]
  rejectedSummary: boolean
  rejectedHighlightCount: number
} {
  const coreMessages = new Map((batch || [])
    .filter(message => (message.analysisScope || 'core') === 'core')
    .map(message => [evidenceKey(message), message]))
  const summaryEvidence = evidenceFor(digest?.summaryEvidenceKeys, coreMessages)
  const requestedSummary = String(digest?.summary || '').trim().slice(0, 900)
  const summary = requestedSummary && summaryEvidence.length ? requestedSummary : ''
  const rawHighlights = Array.isArray(digest?.highlights) ? digest.highlights : []
  const highlights = rawHighlights.flatMap((item: any) => {
    if (!item || typeof item !== 'object') return []
    const text = String(item.text || '').trim().slice(0, 300)
    const evidence = evidenceFor(item.sourceEvidenceKeys, coreMessages)
    if (!text || !evidence.length) return []
    return [{
      text,
      sourceEvidenceKeys: evidence.map(value => value.evidenceKey),
      evidence
    }]
  }).slice(0, 8)
  return {
    summary,
    summaryEvidence,
    highlights,
    rejectedSummary: Boolean(requestedSummary && !summaryEvidence.length),
    rejectedHighlightCount: Math.max(0, rawHighlights.length - highlights.length)
  }
}
