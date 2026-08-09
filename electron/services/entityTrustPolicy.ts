import crypto from 'crypto'

export type EntityTrustStatus = 'candidate' | 'confirmed' | 'legacy_unverified' | 'rejected'

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function isTrustedEntity(entity: any): boolean {
  return entity?.trustStatus === 'confirmed'
}

export function inferLegacyEntityTrustStatus(entity: any): EntityTrustStatus {
  if (['candidate', 'confirmed', 'legacy_unverified', 'rejected'].includes(entity?.trustStatus)) {
    return entity.trustStatus
  }
  return (entity?.accountIds || []).length > 0 || (entity?.externalIdentities || []).length > 0
    ? 'confirmed'
    : 'legacy_unverified'
}

export function buildEntityCreationReview(input: {
  entity: any
  evidenceMessages: any[]
  evidenceKeys: string[]
  createdAt: string
}): any | null {
  if (!input.entity?.id || isTrustedEntity(input.entity)) return null
  const evidence = (input.evidenceMessages || []).map((message, index) => ({
    messageId: String(input.evidenceKeys[index] || ''),
    sessionId: String(message?.sessionId || ''),
    timestamp: Number(message?.timestamp || 0),
    sender: compact(message?.sender || message?.senderIdentity?.displayName || '', 100),
    excerpt: compact(message?.content, 500)
  })).filter(item => item.messageId && item.excerpt)
  if (!evidence.length) return null
  return {
    id: `entity_${crypto.createHash('sha256')
      .update(`${input.entity.id}|${evidence.map(item => item.messageId).join('|')}`)
      .digest('hex').slice(0, 20)}`,
    kind: 'entity_creation',
    title: `${input.entity.canonicalName} · 实体候选`,
    detail: '模型从新增消息中识别出这个实体，但没有稳定身份锚点；确认前只用于本机审阅，不进入可信检索、问答或确定性派生视图。',
    confidence: Math.max(0, Math.min(1, Number(input.entity.confidence || 0.6))),
    status: 'pending',
    createdAt: input.createdAt,
    entityId: input.entity.id,
    entityCanonicalName: input.entity.canonicalName,
    entityType: input.entity.type,
    evidence
  }
}

export function canConfirmEntityCreation(review: any, entity: any): boolean {
  return Boolean(
    review?.kind === 'entity_creation' &&
    review?.entityId === entity?.id &&
    compact(review?.entityCanonicalName, 100).toLocaleLowerCase('zh-CN') ===
      compact(entity?.canonicalName, 100).toLocaleLowerCase('zh-CN') &&
    entity?.trustStatus !== 'rejected'
  )
}

const RESERVED_ENTITY_NAMES = new Set(['我', '你', '用户', '群友', '对方', '某人', '未知', 'unknown', 'user'])

export function planEntityCreationConfirmation(
  review: any,
  entity: any,
  correctedCanonicalName?: string
): { beforeName: string; canonicalName: string; changed: boolean } {
  if (review?.kind !== 'entity_creation' || review?.entityId !== entity?.id) {
    throw new Error('实体候选已失效，请刷新后重试')
  }
  if (entity?.trustStatus === 'rejected') throw new Error('已拒绝的实体不能再次确认')
  const beforeName = compact(entity?.canonicalName, 100)
  const reviewedName = compact(review?.entityCanonicalName, 100)
  if (beforeName.toLocaleLowerCase('zh-CN') !== reviewedName.toLocaleLowerCase('zh-CN')) {
    throw new Error('实体名称已在其他操作中变化，此候选已过期，请刷新后重新审阅')
  }
  const requested = correctedCanonicalName === undefined
    ? reviewedName
    : compact(correctedCanonicalName, 100)
  if (!requested) throw new Error('实体名称不能为空')
  if (/[\u0000-\u001f\u007f]/.test(String(correctedCanonicalName ?? requested))) {
    throw new Error('实体名称不能包含控制字符')
  }
  if (RESERVED_ENTITY_NAMES.has(requested.toLocaleLowerCase('zh-CN'))) {
    throw new Error('不能使用“我、你、用户、群友”等占位词作为实体名称')
  }
  return {
    beforeName,
    canonicalName: requested,
    changed: beforeName.toLocaleLowerCase('zh-CN') !== requested.toLocaleLowerCase('zh-CN')
  }
}

export function buildLegacyEntityReview(input: {
  entity: any
  evidence: any[]
  createdAt: string
}): any | null {
  if (input.entity?.trustStatus !== 'legacy_unverified' || !input.entity?.id) return null
  const evidence = (input.evidence || []).map(item => ({
    sourceId: String(item?.sourceId || item?.source_id || 'legacy'),
    messageId: String(item?.messageId || item?.message_id || ''),
    sessionId: String(item?.sessionId || item?.session_id || ''),
    timestamp: Number(item?.timestamp || 0),
    sender: compact(item?.sender || '', 100),
    excerpt: compact(item?.excerpt, 500)
  })).filter(item => item.messageId || item.excerpt)
  const unique = new Map(evidence.map(item => [
    item.messageId
      ? `${item.sourceId}:${item.sessionId}:${item.messageId}`
      : `${item.sourceId}:${item.sessionId}:${item.timestamp}:${item.excerpt}`,
    item
  ]))
  return {
    id: `entity_legacy_${crypto.createHash('sha256').update(String(input.entity.id)).digest('hex').slice(0, 20)}`,
    kind: 'entity_creation',
    title: `${input.entity.canonicalName} · 历史实体确认`,
    detail: unique.size
      ? '此实体来自旧版抽取，过去没有独立实体可信状态；下方是从相关关系、事实和事件恢复的原文。确认前不参与可信检索或推理。'
      : '此实体来自旧版抽取，过去没有独立实体可信状态，且当前无法恢复关联原文。请根据身份资料谨慎确认或拒绝。',
    confidence: Math.max(0, Math.min(1, Number(input.entity.confidence || 0.5))),
    status: 'pending',
    createdAt: input.createdAt,
    entityId: input.entity.id,
    entityCanonicalName: input.entity.canonicalName,
    entityType: input.entity.type,
    legacyReview: true,
    evidence: [...unique.values()].slice(0, 12)
  }
}
