import crypto from 'crypto'

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
  before: { id: string; subjectId: string; predicate: string; objectId: string }
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
  const id = relationSemanticId(subjectId, predicate, objectId)
  const before = {
    id: String(relation.id),
    subjectId: String(relation.subjectId),
    predicate: compact(relation.predicate, 100),
    objectId: String(relation.objectId)
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
    const knownEvidence = new Set((target.evidence || []).map((item: any) => item.messageId))
    target.evidence = [
      ...(target.evidence || []),
      ...(source.evidence || []).filter((item: any) => !knownEvidence.has(item.messageId))
    ]
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
  source.status = 'confirmed'
  source.updatedAt = input.now
  return { relations: input.relations, confirmedRelation: source, mergedIntoExisting: false }
}
