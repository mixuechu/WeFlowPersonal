import crypto from 'crypto'
import { buildEntityCandidateEvidence } from './entityCandidateEvidencePolicy.ts'

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
  const evidence = buildEntityCandidateEvidence(input.evidenceMessages, input.evidenceKeys)
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

const RESERVED_ALIASES = new Set(['我', '你', '用户', '群友', '对方', '某人', '未知', 'unknown', 'user'])

export function planEntityAliasConfirmation(
  review: any,
  entity: any,
  correctedAliasText?: string
): { suggestedValue: string; finalValue: string; changed: boolean } {
  if (!canApplyEntityAliasCandidate(review, entity)) {
    throw new Error('实体名称已变化或别名候选已失效，请刷新后重试')
  }
  const suggestedValue = compact(review?.aliasText, 100)
  const finalValue = correctedAliasText === undefined
    ? suggestedValue
    : compact(correctedAliasText, 100)
  if (!finalValue) throw new Error('确认别名不能为空')
  if (/[\u0000-\u001f\u007f]/.test(String(correctedAliasText ?? finalValue))) {
    throw new Error('别名不能包含控制字符')
  }
  if (RESERVED_ALIASES.has(normalize(finalValue))) throw new Error('不能使用占位词作为实体别名')
  if (normalize(finalValue) === normalize(entity?.canonicalName)) throw new Error('别名不能与规范名相同')
  if ((entity?.aliases || []).some((alias: string) => normalize(alias) === normalize(finalValue))) {
    throw new Error('该别名已经存在')
  }
  return { suggestedValue, finalValue, changed: normalize(suggestedValue) !== normalize(finalValue) }
}
