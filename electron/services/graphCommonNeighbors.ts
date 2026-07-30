export const GRAPH_QUERY_EVIDENCE_LIMIT = 8

export function boundedGraphEvidence(evidence: any): { evidence: any[]; evidenceTotal: number } {
  const rows = Array.isArray(evidence) ? evidence : []
  const normalized = rows.map(item => ({
    messageId: String(item?.messageId || item?.message_id || ''),
    sessionId: String(item?.sessionId || item?.session_id || ''),
    timestamp: Number(item?.timestamp || 0),
    excerpt: String(item?.excerpt || '').slice(0, 1000)
  })).filter(item => item.messageId || item.excerpt)
  normalized.sort((left, right) => right.timestamp - left.timestamp || right.messageId.localeCompare(left.messageId))
  return {
    evidence: normalized.slice(0, GRAPH_QUERY_EVIDENCE_LIMIT).reverse(),
    evidenceTotal: normalized.length
  }
}

export function findCommonGraphNeighbors(
  fromId: string,
  toId: string,
  entities: any[],
  relations: any[]
): any[] {
  if (!fromId || !toId || fromId === toId) return []
  const entityMap = new Map(entities.map(entity => [entity.id, entity]))
  if (!entityMap.has(fromId) || !entityMap.has(toId)) return []
  const active = relations.filter(relation => relation.status !== 'rejected')
  const edgesFor = (entityId: string) => active.flatMap(relation => {
    if (relation.subjectId === entityId) return [{ relation, neighborId: relation.objectId, forward: true }]
    if (relation.objectId === entityId) return [{ relation, neighborId: relation.subjectId, forward: false }]
    return []
  })
  const leftByNeighbor = new Map<string, any[]>()
  const rightByNeighbor = new Map<string, any[]>()
  for (const edge of edgesFor(fromId)) leftByNeighbor.set(edge.neighborId, [...(leftByNeighbor.get(edge.neighborId) || []), edge])
  for (const edge of edgesFor(toId)) rightByNeighbor.set(edge.neighborId, [...(rightByNeighbor.get(edge.neighborId) || []), edge])
  return [...leftByNeighbor.keys()].flatMap(neighborId => {
    if (neighborId === fromId || neighborId === toId || !rightByNeighbor.has(neighborId)) return []
    const leftEdges = leftByNeighbor.get(neighborId)!
    const rightEdges = rightByNeighbor.get(neighborId)!
    const score = [...leftEdges, ...rightEdges].reduce((sum, edge) =>
      sum + Number(edge.relation.confidence || 0) + (edge.relation.status === 'confirmed' ? 0.25 : 0), 0)
    return [{
      entity: entityMap.get(neighborId),
      score,
      leftEdges: leftEdges.map(edge => ({
        relationId: edge.relation.id,
        predicate: edge.relation.predicate,
        forward: edge.forward,
        status: edge.relation.status,
        confidence: edge.relation.confidence,
        ...boundedGraphEvidence(edge.relation.evidence)
      })),
      rightEdges: rightEdges.map(edge => ({
        relationId: edge.relation.id,
        predicate: edge.relation.predicate,
        forward: edge.forward,
        status: edge.relation.status,
        confidence: edge.relation.confidence,
        ...boundedGraphEvidence(edge.relation.evidence)
      }))
    }]
  }).sort((left, right) => right.score - left.score)
}
