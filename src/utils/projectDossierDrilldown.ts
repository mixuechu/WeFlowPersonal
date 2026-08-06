export type ProjectDossierMetric =
  | 'progress'
  | 'tasks'
  | 'risks'
  | 'claims'
  | 'events'
  | 'evidence'
  | 'reviews'

export type ProjectDossierDrilldown = {
  sectionId: string
  resetScope?: 'claims' | 'events' | 'evidence'
}

export function projectDossierDrilldown(
  metric: ProjectDossierMetric
): ProjectDossierDrilldown {
  if (metric === 'progress' || metric === 'tasks') {
    return { sectionId: 'project-dossier-tasks' }
  }
  if (metric === 'risks') return { sectionId: 'project-dossier-risks' }
  if (metric === 'claims') {
    return { sectionId: 'project-memory-claims', resetScope: 'claims' }
  }
  if (metric === 'events') {
    return { sectionId: 'project-memory-events', resetScope: 'events' }
  }
  if (metric === 'evidence') {
    return { sectionId: 'project-dossier-evidence', resetScope: 'evidence' }
  }
  return { sectionId: 'project-dossier-reviews' }
}
