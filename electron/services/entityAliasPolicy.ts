import crypto from 'crypto'

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalize(value: unknown): string {
  return compact(value, 200).toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

export function buildEntityAliasCandidates(input: {
  entity: any
  aliases: string[]
  evidenceMessages: any[]
  evidenceKeys: string[]
  confidence: unknown
  createdAt: string
}): any[] {
  const currentNames = new Set([
    input.entity?.canonicalName,
    ...(input.entity?.aliases || [])
  ].map(normalize).filter(Boolean))
  const evidence = (input.evidenceMessages || []).map((message, index) => ({
    messageId: String(input.evidenceKeys[index] || ''),
    sessionId: String(message?.sessionId || ''),
    timestamp: Number(message?.timestamp || 0),
    sender: compact(message?.sender || message?.senderIdentity?.displayName || '', 100),
    excerpt: compact(message?.content, 500)
  })).filter(item => item.messageId && item.excerpt)
  if (!evidence.length) return []
  return [...new Set((input.aliases || []).map(alias => compact(alias, 100)).filter(Boolean))]
    .filter(alias => !currentNames.has(normalize(alias)))
    .map(alias => ({
      id: `alias_${crypto.createHash('sha256')
        .update(`${input.entity.id}|${normalize(alias)}|${evidence.map(item => item.messageId).join('|')}`)
        .digest('hex').slice(0, 20)}`,
      kind: 'entity_alias',
      title: `${input.entity.canonicalName} · 别名候选`,
      detail: '模型从新增上下文建议了这个别名，但微信身份字段无法直接验证；确认前不会参与消歧、合并或检索。',
      confidence: Math.max(0, Math.min(1, Number(input.confidence || 0.6))),
      status: 'pending',
      createdAt: input.createdAt,
      entityId: input.entity.id,
      entityCanonicalName: input.entity.canonicalName,
      aliasText: alias,
      evidence
    }))
}

export function canApplyEntityAliasCandidate(review: any, entity: any): boolean {
  if (review?.kind !== 'entity_alias' || entity?.id !== review?.entityId) return false
  if (normalize(entity?.canonicalName) !== normalize(review?.entityCanonicalName)) return false
  const alias = normalize(review?.aliasText)
  return Boolean(alias && alias !== normalize(entity?.canonicalName))
}
