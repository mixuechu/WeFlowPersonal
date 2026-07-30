type GraphViewportOptions = {
  query?: string
  relationType?: string
  relationStatus?: string
  focusEntityId?: string
  depth?: number
  maxNodes?: number
}

function entityMatches(entity: any, query: string): boolean {
  if (!query) return false
  return [
    entity.canonicalName,
    ...(entity.aliases || []),
    ...(entity.accountIds || []),
    ...(entity.externalIdentities || []).flatMap((identity: any) => [identity.accountId, identity.displayName])
  ].some(value => String(value || '').toLowerCase().includes(query))
}

export function buildGraphViewport(entities: any[], relations: any[], options: GraphViewportOptions = {}): {
  entities: any[]
  relations: any[]
  levels: Map<string, number>
  mode: 'overview' | 'search' | 'focus'
  totalAvailable: number
  truncated: number
} {
  const maxNodes = Math.max(10, Math.min(200, Number(options.maxNodes) || 60))
  const depth = Math.max(1, Math.min(3, Number(options.depth) || 1))
  const query = String(options.query || '').trim().toLowerCase()
  const availableEntities = (entities || []).filter(entity => entity.trustStatus !== 'rejected')
  const byId = new Map(availableEntities.map(entity => [entity.id, entity]))
  const availableRelations = (relations || []).filter(relation =>
    relation.status !== 'rejected' &&
    (!options.relationType || relation.predicate === options.relationType) &&
    (!options.relationStatus || relation.status === options.relationStatus) &&
    byId.has(relation.subjectId) && byId.has(relation.objectId))
  const adjacency = new Map<string, Array<{ id: string; relation: any }>>()
  for (const relation of availableRelations) {
    adjacency.set(relation.subjectId, [...(adjacency.get(relation.subjectId) || []), { id: relation.objectId, relation }])
    adjacency.set(relation.objectId, [...(adjacency.get(relation.objectId) || []), { id: relation.subjectId, relation }])
  }
  for (const edges of adjacency.values()) edges.sort((left, right) =>
    Number(right.relation.status === 'confirmed') - Number(left.relation.status === 'confirmed') ||
    Number(right.relation.confidence || 0) - Number(left.relation.confidence || 0) ||
    String(left.id).localeCompare(String(right.id)))

  const focusId = options.focusEntityId && byId.has(options.focusEntityId) ? options.focusEntityId : ''
  const mode = focusId ? 'focus' : query ? 'search' : 'overview'
  let seeds = focusId
    ? [focusId]
    : query
      ? availableEntities.filter(entity => entityMatches(entity, query)).map(entity => entity.id)
      : [...availableEntities].sort((left, right) =>
        Number(adjacency.get(right.id)?.length || 0) - Number(adjacency.get(left.id)?.length || 0) ||
        String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')) ||
        String(left.canonicalName || '').localeCompare(String(right.canonicalName || ''))).map(entity => entity.id)
  seeds = [...new Set(seeds)].slice(0, maxNodes)
  const selected = new Set<string>()
  const levels = new Map<string, number>()
  const queue: Array<{ id: string; level: number }> = []
  for (const id of seeds) {
    if (selected.size >= maxNodes) break
    selected.add(id)
    levels.set(id, 0)
    queue.push({ id, level: 0 })
  }
  if (mode !== 'overview') {
    while (queue.length && selected.size < maxNodes) {
      const current = queue.shift()!
      if (current.level >= depth) continue
      for (const edge of adjacency.get(current.id) || []) {
        if (selected.has(edge.id)) continue
        selected.add(edge.id)
        levels.set(edge.id, current.level + 1)
        queue.push({ id: edge.id, level: current.level + 1 })
        if (selected.size >= maxNodes) break
      }
    }
  }
  const viewportEntities = [...selected].map(id => byId.get(id)).filter(Boolean)
  const viewportRelations = availableRelations.filter(relation =>
    selected.has(relation.subjectId) && selected.has(relation.objectId))
  const relevantTotal = mode === 'overview'
    ? availableEntities.length
    : new Set([...seeds, ...availableRelations.flatMap(relation =>
      selected.has(relation.subjectId) || selected.has(relation.objectId) ? [relation.subjectId, relation.objectId] : [])]).size
  return {
    entities: viewportEntities,
    relations: viewportRelations,
    levels,
    mode,
    totalAvailable: relevantTotal,
    truncated: Math.max(0, relevantTotal - viewportEntities.length)
  }
}
