import crypto from 'crypto'
import { relationTypeViolation } from './relationTypePolicy.ts'

export type RelationCorrection = {
  subjectId?: string
  predicate?: string
  objectId?: string
}

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function relationSemanticId(subjectId: string, predicate: string, objectId: string): string {
  return crypto.createHash('sha256').update(`${subjectId}|${predicate}|${objectId}`).digest('hex').slice(0, 20)
}

export function planRelationConfirmation(input: {
  review: any
  relation: any
  entities: any[]
  correction?: RelationCorrection
}): {
  before: {
    id: string
    subjectId: string
    predicate: string
    objectId: string
    directionExplanation: string
  }
  after: { id: string; subjectId: string; predicate: string; objectId: string; directionExplanation: string }
  changed: boolean
} {
  const { review, relation, entities } = input
  if (review?.kind !== 'relation' || review?.relationId !== relation?.id) {
    throw new Error('关系候选已失效，请刷新后重试')
  }
  if (relation?.status === 'rejected') throw new Error('已拒绝的关系不能再次确认')
  const subjectId = compact(input.correction?.subjectId ?? relation.subjectId, 160)
  const predicate = compact(input.correction?.predicate ?? relation.predicate, 100)
  const objectId = compact(input.correction?.objectId ?? relation.objectId, 160)
  if (!subjectId || !predicate || !objectId) throw new Error('关系主语、谓词和宾语均不能为空')
  if (/[\u0000-\u001f\u007f]/.test(String(input.correction?.predicate ?? predicate))) {
    throw new Error('关系谓词不能包含控制字符')
  }
  if (subjectId === objectId) throw new Error('关系主语和宾语不能是同一个实体')
  const subject = entities.find(entity => entity.id === subjectId)
  const object = entities.find(entity => entity.id === objectId)
  if (subject?.trustStatus !== 'confirmed' || object?.trustStatus !== 'confirmed') {
    throw new Error('请先确认关系两端的实体，再确认关系')
  }
  const typeViolation = relationTypeViolation(
    { subjectId, predicate, objectId },
    entities
  )
  if (typeViolation) throw new Error(`${typeViolation}；请修改谓词或重新选择关系两端`)
  const id = relationSemanticId(subjectId, predicate, objectId)
  const before = {
    id: String(relation.id),
    subjectId: String(relation.subjectId),
    predicate: compact(relation.predicate, 100),
    objectId: String(relation.objectId),
    directionExplanation: compact(relation.directionExplanation, 500)
  }
  const after = {
    id,
    subjectId,
    predicate,
    objectId,
    directionExplanation: `从“${subject.canonicalName}”指向“${object.canonicalName}”：${subject.canonicalName} ${predicate} ${object.canonicalName}。`
  }
  return {
    before,
    after,
    changed: before.id !== after.id ||
      before.subjectId !== after.subjectId ||
      before.predicate !== after.predicate ||
      before.objectId !== after.objectId
  }
}

export function applyRelationConfirmation(input: {
  relations: any[]
  sourceRelationId: string
  plan: ReturnType<typeof planRelationConfirmation>
  now: string
}): { relations: any[]; confirmedRelation: any; mergedIntoExisting: boolean } {
  const source = input.relations.find(relation => relation.id === input.sourceRelationId)
  if (!source) throw new Error('待纠正关系已不存在')
  const target = input.plan.changed
    ? input.relations.find(relation => relation.id === input.plan.after.id && relation.id !== source.id)
    : source
  if (target && target !== source) {
    const evidenceKey = (item: any): string => [
      String(item?.sourceId || item?.source_id || ''),
      String(item?.sessionId || item?.session_id || ''),
      String(item?.messageId || item?.message_id || '')
    ].join('\u001f')
    const knownEvidence = new Set((target.evidence || []).map(evidenceKey))
    const additionalEvidence = (source.evidence || []).filter((item: any) => {
      const key = evidenceKey(item)
      if (knownEvidence.has(key)) return false
      knownEvidence.add(key)
      return true
    })
    target.evidence = [
      ...(target.evidence || []),
      ...additionalEvidence
    ]
    target.evidenceTotal = target.evidence.length
    target.confidence = Math.max(Number(target.confidence || 0), Number(source.confidence || 0))
    target.status = 'confirmed'
    target.directionExplanation = input.plan.after.directionExplanation
    target.updatedAt = input.now
    return {
      relations: input.relations.filter(relation => relation.id !== source.id),
      confirmedRelation: target,
      mergedIntoExisting: true
    }
  }
  source.id = input.plan.after.id
  source.subjectId = input.plan.after.subjectId
  source.predicate = input.plan.after.predicate
  source.objectId = input.plan.after.objectId
  source.directionExplanation = input.plan.after.directionExplanation
  source.evidenceTotal = Math.max(
    Number(source.evidenceTotal || 0),
    Number(source.evidence?.length || 0)
  )
  source.status = 'confirmed'
  source.updatedAt = input.now
  return { relations: input.relations, confirmedRelation: source, mergedIntoExisting: false }
}

function relationStatusRank(value: unknown): number {
  return value === 'confirmed' ? 3 : value === 'candidate' ? 2 : value === 'rejected' ? 1 : 0
}

export function normalizeRelationsAfterIdentityMerge(relations: any[]): any[] {
  const normalized = new Map<string, any>()
  const evidenceKey = (item: any): string => [
    String(item?.sourceId || item?.source_id || ''),
    String(item?.sessionId || item?.session_id || ''),
    String(item?.messageId || item?.message_id || '')
  ].join('\u001f')
  for (const relation of Array.isArray(relations) ? relations : []) {
    if (!relation?.subjectId || !relation?.objectId ||
      relation.subjectId === relation.objectId) continue
    const id = relationSemanticId(
      String(relation.subjectId),
      compact(relation.predicate, 100),
      String(relation.objectId)
    )
    const existing = normalized.get(id)
    if (!existing) {
      normalized.set(id, {
        ...relation,
        id,
        evidence: [...(relation.evidence || [])],
        evidenceTotal: Math.max(
          Number(relation.evidenceTotal || 0),
          Number(relation.evidence?.length || 0)
        )
      })
      continue
    }
    const knownEvidence = new Set((existing.evidence || []).map(evidenceKey))
    for (const item of relation.evidence || []) {
      const key = evidenceKey(item)
      if (knownEvidence.has(key)) continue
      knownEvidence.add(key)
      existing.evidence.push(item)
    }
    if (relationStatusRank(relation.status) > relationStatusRank(existing.status)) {
      existing.status = relation.status
      existing.directionExplanation = relation.directionExplanation
    }
    existing.confidence = Math.max(
      Number(existing.confidence || 0),
      Number(relation.confidence || 0)
    )
    existing.evidenceTotal = Math.max(
      Number(existing.evidenceTotal || 0),
      Number(relation.evidenceTotal || 0),
      existing.evidence.length
    )
    existing.createdAt = [existing.createdAt, relation.createdAt]
      .filter(Boolean).sort()[0] || existing.createdAt
    existing.updatedAt = [existing.updatedAt, relation.updatedAt]
      .filter(Boolean).sort().at(-1) || existing.updatedAt
  }
  return [...normalized.values()]
}

export function reconcileRelationReviewsAfterIdentityMerge(input: {
  reviewQueue: any[]
  relationIdMap: Map<string, string | null>
  relations: any[]
  resolvedAt: string
}): void {
  const relations = new Map((input.relations || []).map(relation => [relation.id, relation]))
  const retainedPending = new Set<string>()
  for (const review of input.reviewQueue || []) {
    if (review?.kind !== 'relation' || review?.status !== 'pending' ||
      !input.relationIdMap.has(String(review.relationId || ''))) continue
    const mappedId = input.relationIdMap.get(String(review.relationId || '')) || null
    const target = mappedId ? relations.get(mappedId) : null
    let reason = ''
    if (!target) reason = '身份合并后关系成为自环或已经消失'
    else if (target.status === 'confirmed') reason = '身份合并后候选已并入人工确认关系'
    else if (retainedPending.has(mappedId!)) reason = '身份合并后候选与另一条待审关系重复'
    if (reason) {
      review.status = 'rejected'
      review.resolvedAt = input.resolvedAt
      review.resolutionActor = 'system'
      review.resolutionReason = reason
      review.detail = `${String(review.detail || '')} ${reason}，此候选自动关闭。`.trim()
      continue
    }
    review.relationId = mappedId
    retainedPending.add(mappedId!)
  }
}
