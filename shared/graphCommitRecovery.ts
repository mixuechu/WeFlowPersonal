export const GRAPH_COMMIT_RECOVERY_VERSION = 'graph-sql-authority-v1'

export function shouldRecoverGraphFromSql(
  sqlCommitId: unknown,
  stateCommitId: unknown
): boolean {
  const sql = String(sqlCommitId || '').trim()
  const state = String(stateCommitId || '').trim()
  return Boolean(sql && state && sql !== state)
}

export function recoverGraphStateFromSql(
  previous: any,
  snapshot: any,
  sqlCommitId: string
): any {
  const previousEntities = new Map<string, any>(
    (Array.isArray(previous?.entities) ? previous.entities : []).map((entity: any) => [entity.id, entity])
  )
  const previousRelations = new Map<string, any>(
    (Array.isArray(previous?.relations) ? previous.relations : []).map((relation: any) => [relation.id, relation])
  )
  return {
    ...previous,
    entities: (Array.isArray(snapshot?.entities) ? snapshot.entities : []).map((entity: any) => ({
      ...previousEntities.get(entity.id),
      ...entity,
      evidenceMessageIds: [...new Set([
        ...(entity.evidenceMessageIds || []),
        ...((previousEntities.get(entity.id) as any)?.evidenceMessageIds || [])
      ])]
    })),
    relations: (Array.isArray(snapshot?.relations) ? snapshot.relations : []).map((relation: any) => ({
      ...previousRelations.get(relation.id),
      ...relation,
      directionExplanation: (previousRelations.get(relation.id) as any)?.directionExplanation || ''
    })),
    reviewQueue: Array.isArray(snapshot?.reviewQueue) ? snapshot.reviewQueue : [],
    lastSqlCommitId: sqlCommitId
  }
}
