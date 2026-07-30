import crypto from 'crypto'

export type EntitySummaryEvidence = {
  messageId: string
  sessionId: string
  timestamp: number
  sender: string
  excerpt: string
}

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function buildEntitySummaryCandidate(input: {
  entityId: string
  entityName: string
  previousSummary?: string
  summary: unknown
  confidence: unknown
  evidenceMessages: any[]
  evidenceKeys: string[]
  identityVersion: number
  createdAt: string
}): any | null {
  const summaryText = compact(input.summary, 800)
  const previousSummary = compact(input.previousSummary, 800)
  if (!summaryText || summaryText === previousSummary) return null
  const evidence: EntitySummaryEvidence[] = (input.evidenceMessages || []).map((message, index) => ({
    messageId: String(input.evidenceKeys[index] || ''),
    sessionId: String(message?.sessionId || ''),
    timestamp: Number(message?.timestamp || 0),
    sender: compact(message?.sender || message?.senderIdentity?.displayName || '', 100),
    excerpt: compact(message?.content, 500)
  })).filter(item => item.messageId && item.excerpt)
  if (!evidence.length) return null
  const id = `summary_${crypto.createHash('sha256')
    .update(`${input.entityId}|${summaryText}|${evidence.map(item => item.messageId).join('|')}`)
    .digest('hex').slice(0, 20)}`
  return {
    id,
    kind: 'entity_summary',
    title: `${input.entityName} · 摘要候选`,
    detail: previousSummary
      ? '模型建议用这段有原文依据的摘要替换当前摘要；确认前不会覆盖，也不会进入可信检索。'
      : '模型从新增原文中提取了人物摘要；确认前不会写入可信档案或检索语料。',
    confidence: Math.max(0, Math.min(1, Number(input.confidence || 0.6))),
    status: 'pending',
    createdAt: input.createdAt,
    entityId: input.entityId,
    entityIdentityVersion: input.identityVersion,
    previousSummary,
    summaryText,
    evidence
  }
}

export function canApplyEntitySummaryCandidate(review: any, entity: any): boolean {
  return Boolean(
    review?.kind === 'entity_summary' &&
    entity?.id === review?.entityId &&
    compact(entity?.summary, 800) === compact(review?.previousSummary, 800)
  )
}
