export const IDENTITY_MERGE_SNAPSHOT_VERSION = 'identity-merge-snapshot-v2'

export type IdentityMergeSnapshotCompaction = {
  snapshot: any
  valid: boolean
  changed: boolean
  originalRelations: number
  retainedRelations: number
}

export function compactIdentityMergeSnapshot(input: any): IdentityMergeSnapshotCompaction {
  const sourceId = String(input?.source?.id || '')
  const targetId = String(input?.target?.id || '')
  if (!sourceId || !targetId || !Array.isArray(input?.relations)) {
    return {
      snapshot: input,
      valid: false,
      changed: false,
      originalRelations: Array.isArray(input?.relations) ? input.relations.length : 0,
      retainedRelations: Array.isArray(input?.relations) ? input.relations.length : 0
    }
  }
  const relations = input.relations.filter((relation: any) =>
    relation?.subjectId === sourceId || relation?.objectId === sourceId ||
    relation?.subjectId === targetId || relation?.objectId === targetId)
  const snapshot = {
    version: IDENTITY_MERGE_SNAPSHOT_VERSION,
    scope: 'affected_entities_relations_reviews_events',
    source: input.source,
    target: input.target,
    relations,
    sourceEventParticipants: Array.isArray(input.sourceEventParticipants)
      ? input.sourceEventParticipants : [],
    targetEventParticipants: Array.isArray(input.targetEventParticipants)
      ? input.targetEventParticipants : [],
    affectedReviews: Array.isArray(input.affectedReviews) ? input.affectedReviews : [],
    ...(input.relationEvidenceLineage?.version === 'identity-merge-relation-evidence-v1'
      ? { relationEvidenceLineage: input.relationEvidenceLineage }
      : {})
  }
  return {
    snapshot,
    valid: true,
    changed: JSON.stringify(snapshot) !== JSON.stringify(input),
    originalRelations: input.relations.length,
    retainedRelations: relations.length
  }
}
