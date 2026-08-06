export type EntityDossierMetric =
  | 'aliases'
  | 'wechat'
  | 'external'
  | 'evidence'
  | 'currentEvidence'
  | 'claims'
  | 'relationships'
  | 'events'
  | 'tasks'
  | 'pendingCommitments'

export type EntityDossierDrilldown = {
  sectionId: string
  identityKind?: 'alias' | 'wechat' | 'external'
  resetScope?: 'evidence' | 'currentEvidence' | 'claims' | 'relationships' | 'events'
  eventPreset?: 'pendingCommitments'
}

export function entityDossierDrilldown(
  metric: EntityDossierMetric
): EntityDossierDrilldown {
  if (metric === 'aliases' || metric === 'wechat' || metric === 'external') {
    return {
      sectionId: 'entity-dossier-identities',
      identityKind: metric === 'aliases' ? 'alias' : metric
    }
  }
  if (metric === 'evidence' || metric === 'currentEvidence') {
    return {
      sectionId: 'entity-dossier-evidence',
      resetScope: metric
    }
  }
  if (metric === 'relationships') {
    return {
      sectionId: 'entity-dossier-relations',
      resetScope: 'relationships'
    }
  }
  if (metric === 'claims') {
    return {
      sectionId: 'entity-dossier-claims',
      resetScope: 'claims'
    }
  }
  if (metric === 'events') {
    return {
      sectionId: 'entity-dossier-events',
      resetScope: 'events'
    }
  }
  if (metric === 'pendingCommitments') {
    return {
      sectionId: 'entity-dossier-events',
      eventPreset: 'pendingCommitments'
    }
  }
  return { sectionId: 'entity-dossier-tasks' }
}
