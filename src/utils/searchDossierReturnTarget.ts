export type SearchDossierKind =
  | 'project'
  | 'entity'
  | 'task'
  | 'resource'
  | 'structured'
  | 'evidence'

export type SearchDossierReturnTarget = {
  kind: SearchDossierKind
  documentId: string
}

export function buildSearchDossierReturnTarget(
  kind: SearchDossierKind,
  documentId: unknown
): SearchDossierReturnTarget | null {
  const id = String(documentId || '').trim()
  return id ? { kind, documentId: id } : null
}

export function resolveSearchDossierReturn(
  target: SearchDossierReturnTarget | null,
  expectedKind?: SearchDossierKind
): string {
  return target && (!expectedKind || target.kind === expectedKind)
    ? target.documentId
    : ''
}
