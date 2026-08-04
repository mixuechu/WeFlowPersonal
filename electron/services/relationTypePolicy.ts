const PERSON_ONLY_RELATION_PATTERN = /伴侣|配偶|夫妻|父亲|母亲|兄弟|姐妹|朋友|同学/

export type RelationTypeEntity = {
  id?: unknown
  type?: unknown
}

export type RelationTypeRelation = {
  id?: unknown
  subjectId?: unknown
  predicate?: unknown
  objectId?: unknown
  status?: unknown
  updatedAt?: unknown
}

export function relationTypeViolation(
  relation: RelationTypeRelation,
  entities: RelationTypeEntity[]
): string | null {
  const predicate = String(relation?.predicate || '').trim()
  if (!PERSON_ONLY_RELATION_PATTERN.test(predicate)) return null
  const entityTypes = new Map(entities.map(entity => [
    String(entity.id || ''),
    String(entity.type || '')
  ]))
  const subjectType = entityTypes.get(String(relation.subjectId || ''))
  const objectType = entityTypes.get(String(relation.objectId || ''))
  if (subjectType === 'person' && objectType === 'person') return null
  return `“${predicate}”属于人物之间的关系，但当前主语或宾语不是人物`
}

export function quarantineInvalidRelationTypes<T extends RelationTypeRelation>(
  relations: T[],
  entities: RelationTypeEntity[],
  updatedAt: string
): { relations: T[]; invalidRelationIds: string[]; changed: number } {
  const invalidRelationIds: string[] = []
  let changed = 0
  const next = relations.map(relation => {
    if (!relationTypeViolation(relation, entities)) return relation
    invalidRelationIds.push(String(relation.id || ''))
    if (relation.status === 'candidate' || relation.status === 'rejected') return relation
    changed += 1
    return { ...relation, status: 'candidate', updatedAt } as T
  })
  return {
    relations: next,
    invalidRelationIds: invalidRelationIds.filter(Boolean),
    changed
  }
}
