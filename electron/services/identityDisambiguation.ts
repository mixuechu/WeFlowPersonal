export type IdentityCandidateEntity = {
  id: string
  type: string
  canonicalName: string
  aliases?: string[]
  accountIds?: string[]
  identityVersion?: number
}

export type IdentityCandidateSignal = {
  source: 'shared_account' | 'exact_name' | 'alias_overlap'
  label: string
  value: string
  weight: number
}

export type IdentityCandidateAssessment = {
  eligible: boolean
  confidence: number
  signals: IdentityCandidateSignal[]
}

export type IdentityPairSuggestion = {
  leftId: string
  rightId: string
  source: 'graph_neighbors' | 'vector_similarity'
  detail: string
  confidence: number
  label: string
  value: string
}

export type IdentityCandidateLookup = {
  bySignal: Map<string, IdentityCandidateEntity[]>
  memberIdsBySignal: Map<string, Set<string>>
  orderById: Map<string, number>
}

export const FULL_IDENTITY_SCAN_THRESHOLD = 500
export const FULL_IDENTITY_SCAN_INTERVAL_DAYS = 7
export const MAX_GRAPH_IDENTITY_NEIGHBOR_PEOPLE = 500
export const MAX_GRAPH_IDENTITY_PAIR_CANDIDATES = 100_000
export const MAX_GRAPH_IDENTITY_SUGGESTIONS = 2_000

function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function identitySignals(entity: IdentityCandidateEntity): string[] {
  if (entity.type !== 'person') return []
  return [...new Set([
    ...(entity.accountIds || []).map(value => `account:${normalize(value)}`),
    ...[entity.canonicalName, ...(entity.aliases || [])]
      .map(normalize).filter(value => value.length >= 2).map(value => `name:${value}`)
  ].filter(value => !value.endsWith(':')))]
}

export function addIdentityCandidateToLookup(
  lookup: IdentityCandidateLookup,
  entity: IdentityCandidateEntity,
  order = lookup.orderById.size
): void {
  if (!lookup.orderById.has(entity.id)) lookup.orderById.set(entity.id, order)
  for (const signal of identitySignals(entity)) {
    const memberIds = lookup.memberIdsBySignal.get(signal) || new Set<string>()
    if (memberIds.has(entity.id)) continue
    memberIds.add(entity.id)
    lookup.memberIdsBySignal.set(signal, memberIds)
    lookup.bySignal.set(signal, [...(lookup.bySignal.get(signal) || []), entity])
  }
}

export function buildIdentityCandidateLookup(
  entities: IdentityCandidateEntity[]
): IdentityCandidateLookup {
  const lookup: IdentityCandidateLookup = {
    bySignal: new Map(),
    memberIdsBySignal: new Map(),
    orderById: new Map()
  }
  entities.forEach((entity, order) => addIdentityCandidateToLookup(lookup, entity, order))
  return lookup
}

export function listIndexedIdentityCandidates(
  lookup: IdentityCandidateLookup,
  entity: IdentityCandidateEntity
): IdentityCandidateEntity[] {
  const candidates = new Map<string, IdentityCandidateEntity>()
  for (const signal of identitySignals(entity)) {
    for (const candidate of lookup.bySignal.get(signal) || []) {
      if (candidate.id !== entity.id) candidates.set(candidate.id, candidate)
    }
  }
  return [...candidates.values()].sort((left, right) =>
    (lookup.orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (lookup.orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER))
}

export function assessIdentityPair(
  left: IdentityCandidateEntity,
  right: IdentityCandidateEntity
): IdentityCandidateAssessment {
  if (left.id === right.id || left.type !== 'person' || right.type !== 'person') {
    return { eligible: false, confidence: 0, signals: [] }
  }
  const leftAccounts = new Set((left.accountIds || []).map(normalize).filter(Boolean))
  const rightAccounts = new Set((right.accountIds || []).map(normalize).filter(Boolean))
  const sharedAccount = [...leftAccounts].find(value => rightAccounts.has(value))
  const leftCanonical = normalize(left.canonicalName)
  const rightCanonical = normalize(right.canonicalName)
  const leftAliases = new Set((left.aliases || []).map(normalize).filter(value => value.length >= 2))
  const rightAliases = new Set((right.aliases || []).map(normalize).filter(value => value.length >= 2))
  const signals: IdentityCandidateSignal[] = []
  if (sharedAccount) {
    signals.push({ source: 'shared_account', label: '共享稳定账号', value: sharedAccount, weight: 1 })
  }
  if (leftCanonical.length >= 2 && leftCanonical === rightCanonical) {
    signals.push({ source: 'exact_name', label: '规范名完全相同', value: left.canonicalName, weight: 0.72 })
  }
  const sharedAlias = [...new Set([leftCanonical, ...leftAliases])]
    .find(value => value.length >= 2 && new Set([rightCanonical, ...rightAliases]).has(value))
  if (sharedAlias && !signals.some(item => item.source === 'exact_name' || item.source === 'shared_account')) {
    signals.push({ source: 'alias_overlap', label: '名称或别名重合', value: sharedAlias, weight: 0.65 })
  }
  const confidence = Math.min(1, signals.reduce((score, signal) => Math.max(score, signal.weight), 0))
  return { eligible: confidence >= 0.65, confidence, signals }
}

export function identityPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join('|')
}

export function planStaleVectorIdentityReviews(
  reviews: Array<{
    id?: string
    kind?: string
    status?: string
    leftEntityId?: string
    rightEntityId?: string
    candidateSource?: string
    candidateSignals?: Array<{ source?: string }>
  }>,
  scannedEntityIds: ReadonlySet<string>,
  currentPairKeys: ReadonlySet<string>,
  complete: boolean
): string[] {
  if (!complete || !scannedEntityIds.size) return []
  return reviews.flatMap(review => {
    const leftId = String(review.leftEntityId || '')
    const rightId = String(review.rightEntityId || '')
    const signals = Array.isArray(review.candidateSignals) ? review.candidateSignals : []
    const pureVector = review.candidateSource === 'vector_similarity' &&
      (!signals.length || signals.every(signal => signal?.source === 'vector_similarity'))
    if (!review.id || review.kind !== 'possible_duplicate' || review.status !== 'pending' ||
      !leftId || !rightId || !pureVector ||
      (!scannedEntityIds.has(leftId) && !scannedEntityIds.has(rightId)) ||
      currentPairKeys.has(identityPairKey(leftId, rightId))) return []
    return [String(review.id)]
  })
}

export function planStaleGraphIdentityReviews(
  reviews: Array<{
    id?: string
    kind?: string
    status?: string
    leftEntityId?: string
    rightEntityId?: string
    candidateSource?: string
    candidateSignals?: Array<{ source?: string }>
  }>,
  currentPairKeys: ReadonlySet<string>,
  complete: boolean
): string[] {
  if (!complete) return []
  return reviews.flatMap(review => {
    const leftId = String(review.leftEntityId || '')
    const rightId = String(review.rightEntityId || '')
    const signals = Array.isArray(review.candidateSignals) ? review.candidateSignals : []
    const pureGraph = review.candidateSource === 'graph_neighbors' &&
      (!signals.length || signals.every(signal => signal?.source === 'graph_neighbors'))
    if (!review.id || review.kind !== 'possible_duplicate' || review.status !== 'pending' ||
      !leftId || !rightId || !pureGraph ||
      currentPairKeys.has(identityPairKey(leftId, rightId))) return []
    return [String(review.id)]
  })
}

export function isNegativeDecisionCurrent(
  decision: any,
  left: IdentityCandidateEntity,
  right: IdentityCandidateEntity
): boolean {
  if (decision?.decision !== 'different') return false
  const ordered = left.id <= right.id ? [left, right] : [right, left]
  return Number(decision.left_version) === Number(ordered[0].identityVersion || 1) &&
    Number(decision.right_version) === Number(ordered[1].identityVersion || 1)
}

export function getFullIdentityScanSchedule(
  entityCount: number,
  lastFullScanAt: string | null | undefined,
  now = new Date()
): { mode: 'incremental' | 'full'; due: boolean; nextFullScanAt: string | null; reason: string } {
  if (entityCount < FULL_IDENTITY_SCAN_THRESHOLD) {
    return {
      mode: 'incremental',
      due: false,
      nextFullScanAt: null,
      reason: `当前 ${entityCount} 个实体；达到 ${FULL_IDENTITY_SCAN_THRESHOLD} 个后启用每周全图巡检`
    }
  }
  const last = lastFullScanAt ? Date.parse(lastFullScanAt) : Number.NaN
  const intervalMs = FULL_IDENTITY_SCAN_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  const due = !Number.isFinite(last) || now.getTime() - last >= intervalMs
  const next = Number.isFinite(last) ? new Date(last + intervalMs).toISOString() : now.toISOString()
  return {
    mode: 'full',
    due,
    nextFullScanAt: next,
    reason: due ? '已达到规模阈值，本次同步执行低频全图巡检' : `全图巡检每 ${FULL_IDENTITY_SCAN_INTERVAL_DAYS} 天执行一次`
  }
}

export function buildNameBuckets(entities: IdentityCandidateEntity[]): Map<string, string[]> {
  const buckets = new Map<string, string[]>()
  for (const entity of entities) {
    if (entity.type !== 'person') continue
    const names = new Set([entity.canonicalName, ...(entity.aliases || [])].map(normalize).filter(value => value.length >= 2))
    for (const name of names) {
      const ids = buckets.get(name) || []
      ids.push(entity.id)
      buckets.set(name, ids)
    }
  }
  return buckets
}

export function buildNameIdentityPairPlan(
  entities: IdentityCandidateEntity[],
  maxPairCandidates = MAX_GRAPH_IDENTITY_PAIR_CANDIDATES
): {
  pairKeys: string[]
  stats: {
    people: number
    nameBuckets: number
    largestBucket: number
    pairCandidates: number
    truncated: boolean
  }
} {
  const limit = Math.max(1, Math.floor(maxPairCandidates))
  const buckets = buildNameBuckets(entities)
  const pairKeys = new Set<string>()
  let largestBucket = 0
  let truncated = false
  for (const ids of buckets.values()) largestBucket = Math.max(largestBucket, ids.length)
  bucketLoop: for (const ids of buckets.values()) {
    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const key = identityPairKey(ids[leftIndex], ids[rightIndex])
        if (!pairKeys.has(key) && pairKeys.size >= limit) {
          truncated = true
          break bucketLoop
        }
        pairKeys.add(key)
      }
    }
  }
  return {
    pairKeys: [...pairKeys],
    stats: {
      people: entities.filter(entity => entity.type === 'person').length,
      nameBuckets: buckets.size,
      largestBucket,
      pairCandidates: pairKeys.size,
      truncated
    }
  }
}

export function buildGraphIdentitySuggestions(
  entities: IdentityCandidateEntity[],
  relations: Array<{ subjectId: string; objectId: string; predicate?: string; status?: string }>
): IdentityPairSuggestion[] {
  return buildGraphIdentitySuggestionPlan(entities, relations).suggestions
}

export function buildGraphIdentitySuggestionPlan(
  entities: IdentityCandidateEntity[],
  relations: Array<{ subjectId: string; objectId: string; predicate?: string; status?: string }>,
  options: {
    maxPeoplePerNeighbor?: number
    maxPairCandidates?: number
    maxSuggestions?: number
  } = {}
): {
  suggestions: IdentityPairSuggestion[]
  stats: {
    people: number
    relations: number
    eligibleNeighbors: number
    skippedHighDegreeNeighbors: number
    pairCandidates: number
    suggestions: number
    truncated: boolean
  }
} {
  const maxPeoplePerNeighbor = Math.max(2, Math.floor(
    options.maxPeoplePerNeighbor ?? MAX_GRAPH_IDENTITY_NEIGHBOR_PEOPLE))
  const maxPairCandidates = Math.max(1, Math.floor(
    options.maxPairCandidates ?? MAX_GRAPH_IDENTITY_PAIR_CANDIDATES))
  const maxSuggestions = Math.max(1, Math.floor(
    options.maxSuggestions ?? MAX_GRAPH_IDENTITY_SUGGESTIONS))
  const people = new Set(entities.filter(entity => entity.type === 'person').map(entity => entity.id))
  const peopleByNeighbor = new Map<string, Set<string>>()
  for (const relation of relations) {
    if (relation.status === 'rejected') continue
    if (people.has(relation.subjectId)) {
      const set = peopleByNeighbor.get(relation.objectId) || new Set<string>()
      set.add(relation.subjectId)
      peopleByNeighbor.set(relation.objectId, set)
    }
    if (people.has(relation.objectId)) {
      const set = peopleByNeighbor.get(relation.subjectId) || new Set<string>()
      set.add(relation.objectId)
      peopleByNeighbor.set(relation.subjectId, set)
    }
  }
  const ids = [...people]
  const orderById = new Map(ids.map((id, index) => [id, index]))
  const pairCounts = new Map<string, number>()
  let eligibleNeighbors = 0
  let skippedHighDegreeNeighbors = 0
  let truncated = false
  const neighborBuckets = [...peopleByNeighbor.entries()]
    .filter(([, linkedPeople]) => linkedPeople.size >= 2)
    .sort(([leftId, left], [rightId, right]) => left.size - right.size || leftId.localeCompare(rightId))
  for (const [, linkedPeople] of neighborBuckets) {
    if (linkedPeople.size > maxPeoplePerNeighbor) {
      skippedHighDegreeNeighbors += 1
      continue
    }
    eligibleNeighbors += 1
    const linkedIds = [...linkedPeople].sort((left, right) =>
      (orderById.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right) ?? Number.MAX_SAFE_INTEGER))
    for (let leftIndex = 0; leftIndex < linkedIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < linkedIds.length; rightIndex += 1) {
        const key = identityPairKey(linkedIds[leftIndex], linkedIds[rightIndex])
        if (!pairCounts.has(key) && pairCounts.size >= maxPairCandidates) {
          truncated = true
          continue
        }
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1)
      }
    }
  }
  const suggestions = [...pairCounts.entries()]
    .filter(([, shared]) => shared >= 2)
    .map(([key, shared]) => {
      const [firstId, secondId] = key.split('|')
      const [leftId, rightId] =
        (orderById.get(firstId) ?? Number.MAX_SAFE_INTEGER) <=
        (orderById.get(secondId) ?? Number.MAX_SAFE_INTEGER)
          ? [firstId, secondId]
          : [secondId, firstId]
      return {
        leftId,
        rightId,
        source: 'graph_neighbors',
        label: '共享图谱邻居',
        value: `${shared} 个`,
        detail: `两个人物连接到 ${shared} 个相同实体，可能是同一人的不同账号，需人工确认。`,
        confidence: Math.min(0.9, 0.66 + shared * 0.06)
      } as IdentityPairSuggestion
    })
    .sort((left, right) =>
      (orderById.get(left.leftId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.leftId) ?? Number.MAX_SAFE_INTEGER) ||
      (orderById.get(left.rightId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.rightId) ?? Number.MAX_SAFE_INTEGER))
  if (suggestions.length > maxSuggestions) truncated = true
  const boundedSuggestions = suggestions.slice(0, maxSuggestions)
  return {
    suggestions: boundedSuggestions,
    stats: {
      people: people.size,
      relations: relations.length,
      eligibleNeighbors,
      skippedHighDegreeNeighbors,
      pairCandidates: pairCounts.size,
      suggestions: boundedSuggestions.length,
      truncated
    }
  }
}
