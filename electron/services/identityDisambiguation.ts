import { createHash } from 'node:crypto'

export type IdentityCandidateEntity = {
  id: string
  type: string
  canonicalName: string
  aliases?: string[]
  accountIds?: string[]
  identityVersion?: number
  trustStatus?: string
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
export const FULL_IDENTITY_SCAN_PAGE_SIZE = 10_000
const IDENTITY_SCAN_CURSOR_MAX_CHARS = 2_048

export function identityNameScanIdleStatus(input: {
  pending: boolean
  maintenance: boolean
  syncing: boolean
  vectorIndexing: boolean
  searchRepairing: boolean
  resourceEnriching: boolean
  taskAuditing: boolean
}): 'no_pending_scan' | 'busy' | 'due' {
  if (!input.pending) return 'no_pending_scan'
  return input.maintenance || input.syncing || input.vectorIndexing || input.searchRepairing ||
    input.resourceEnriching || input.taskAuditing ? 'busy' : 'due'
}

function boundedCount(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0
}

function validIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const text = value
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null
}

export function normalizePersistedIdentityScanState(
  raw: unknown,
  defaults: Record<string, any>
): Record<string, any> {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, any> : {}
  const cursor = typeof value.fullScanCursor === 'string' &&
    value.fullScanCursor.length <= IDENTITY_SCAN_CURSOR_MAX_CHARS &&
    decodeNameScanCursor(value.fullScanCursor)
    ? value.fullScanCursor : null
  const fingerprint = typeof value.fullScanSnapshotFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.fullScanSnapshotFingerprint)
    ? value.fullScanSnapshotFingerprint : null
  const continuationValid = Boolean(cursor && fingerprint)
  const countKeys = Object.keys(defaults).filter(key => typeof defaults[key] === 'number')
  const booleanKeys = Object.keys(defaults).filter(key => typeof defaults[key] === 'boolean')
  const normalized: Record<string, any> = { ...defaults }
  for (const key of countKeys) normalized[key] = boundedCount(value[key])
  for (const key of booleanKeys) {
    normalized[key] = typeof value[key] === 'boolean' ? value[key] : defaults[key]
  }
  normalized.lastFullScanAt = validIsoOrNull(value.lastFullScanAt)
  normalized.lastRunAt = validIsoOrNull(value.lastRunAt)
  normalized.lastMode = value.lastMode === 'incremental' || value.lastMode === 'full'
    ? value.lastMode : null
  normalized.decisionLookupAt = validIsoOrNull(value.decisionLookupAt)
  normalized.vectorContinuationAt = validIsoOrNull(value.vectorContinuationAt)
  normalized.vectorContinuationError = String(value.vectorContinuationError || '').slice(0, 500) || null
  normalized.fullScanContinuationAt = validIsoOrNull(value.fullScanContinuationAt)
  normalized.fullScanContinuationError = String(value.fullScanContinuationError || '').slice(0, 500) || null
  normalized.fullScanCursor = continuationValid ? cursor : null
  normalized.fullScanSnapshotFingerprint = continuationValid ? fingerprint : null
  normalized.fullScanProcessedPairs = continuationValid
    ? boundedCount(value.fullScanProcessedPairs) : 0
  normalized.fullTruncated = continuationValid && Boolean(value.fullTruncated)
  return normalized
}

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

export function resolveModelIdentitySuggestionTarget(
  suggestion: {
    rightExistingEntityId?: string
    rightExistingName?: string
  },
  entitiesById: ReadonlyMap<string, IdentityCandidateEntity>
): IdentityCandidateEntity | null {
  const entityId = String(suggestion?.rightExistingEntityId || '').trim()
  const expectedName = String(suggestion?.rightExistingName || '').trim()
  const entity = entitiesById.get(entityId)
  if (!entityId || !expectedName || !entity || entity.type !== 'person' ||
    entity.trustStatus !== 'confirmed' || entity.canonicalName !== expectedName) return null
  return entity
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

export function planStaleRuleIdentityReviews(
  reviews: Array<{
    id?: string
    kind?: string
    status?: string
    leftEntityId?: string
    rightEntityId?: string
    candidateSource?: string
    candidateSignals?: Array<{ source?: string }>
  }>,
  entitiesById: ReadonlyMap<string, IdentityCandidateEntity>
): string[] {
  const ruleSources = new Set(['rule', 'shared_account', 'exact_name', 'alias_overlap'])
  return reviews.flatMap(review => {
    const signals = Array.isArray(review.candidateSignals) ? review.candidateSignals : []
    const pureRule = ruleSources.has(String(review.candidateSource || '')) &&
      (!signals.length || signals.every(signal => ruleSources.has(String(signal?.source || ''))))
    if (!review.id || review.kind !== 'possible_duplicate' || review.status !== 'pending' || !pureRule) {
      return []
    }
    const left = entitiesById.get(String(review.leftEntityId || ''))
    const right = entitiesById.get(String(review.rightEntityId || ''))
    if (left && right && assessIdentityPair(left, right).eligible) return []
    return [String(review.id)]
  })
}

export function planStaleIdentityVersionReviews(
  reviews: Array<{
    id?: string
    kind?: string
    status?: string
    leftEntityId?: string
    rightEntityId?: string
    leftIdentityVersion?: number
    rightIdentityVersion?: number
  }>,
  entitiesById: ReadonlyMap<string, IdentityCandidateEntity>
): string[] {
  return reviews.flatMap(review => {
    if (!review.id || review.kind !== 'possible_duplicate' || review.status !== 'pending') return []
    if (identityCandidateVersionsCurrent(review, entitiesById)) return []
    return [String(review.id)]
  })
}

export function identityCandidateVersionsCurrent(
  review: {
    leftEntityId?: string
    rightEntityId?: string
    leftIdentityVersion?: number
    rightIdentityVersion?: number
  },
  entitiesById: ReadonlyMap<string, IdentityCandidateEntity>
): boolean {
  const left = entitiesById.get(String(review.leftEntityId || ''))
  const right = entitiesById.get(String(review.rightEntityId || ''))
  const expectedLeft = Number(review.leftIdentityVersion)
  const expectedRight = Number(review.rightIdentityVersion)
  return Boolean(left && right &&
    Number.isInteger(expectedLeft) && expectedLeft >= 1 &&
    Number.isInteger(expectedRight) && expectedRight >= 1 &&
    expectedLeft === Number(left.identityVersion || 1) &&
    expectedRight === Number(right.identityVersion || 1))
}

export function assertIdentityCandidateVersionsCurrent(
  review: {
    leftEntityId?: string
    rightEntityId?: string
    leftIdentityVersion?: number
    rightIdentityVersion?: number
  },
  entitiesById: ReadonlyMap<string, IdentityCandidateEntity>
): void {
  const leftId = String(review.leftEntityId || '')
  const rightId = String(review.rightEntityId || '')
  const left = entitiesById.get(leftId)
  const right = entitiesById.get(rightId)
  if (!leftId || !rightId || !left || !right) {
    throw new Error('身份合并候选的实体已经不存在，请刷新后拒绝旧候选')
  }
  const expectedLeft = Number(review.leftIdentityVersion)
  const expectedRight = Number(review.rightIdentityVersion)
  if (!Number.isInteger(expectedLeft) || expectedLeft < 1 ||
    !Number.isInteger(expectedRight) || expectedRight < 1) {
    throw new Error('旧版身份合并候选缺少实体版本，不能直接确认；请拒绝后等待重新识别')
  }
  if (!identityCandidateVersionsCurrent(review, entitiesById)) {
    throw new Error('身份合并候选生成后人物档案已经变化，请刷新后重新核对')
  }
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

export function projectIdentityScanDiagnostics(
  scan: Record<string, any>,
  schedule: ReturnType<typeof getFullIdentityScanSchedule>
): Record<string, unknown> {
  return {
    lastFullScanAt: scan.lastFullScanAt || null,
    lastRunAt: scan.lastRunAt || null,
    lastMode: scan.lastMode || null,
    lastCandidateCount: Number(scan.lastCandidateCount || 0),
    contextualRelations: Number(scan.contextualRelations || 0),
    contextualEligibleNeighbors: Number(scan.contextualEligibleNeighbors || 0),
    contextualSkippedHubs: Number(scan.contextualSkippedHubs || 0),
    contextualPairCandidates: Number(scan.contextualPairCandidates || 0),
    contextualTruncated: Boolean(scan.contextualTruncated),
    contextualRetiredCandidates: Number(scan.contextualRetiredCandidates || 0),
    versionRetiredCandidates: Number(scan.versionRetiredCandidates || 0),
    versionRegeneratedCandidates: Number(scan.versionRegeneratedCandidates || 0),
    ruleRetiredCandidates: Number(scan.ruleRetiredCandidates || 0),
    fullPairCandidates: Number(scan.fullPairCandidates || 0),
    fullLargestNameBucket: Number(scan.fullLargestNameBucket || 0),
    fullTruncated: Boolean(scan.fullTruncated),
    fullScanProcessedPairs: Number(scan.fullScanProcessedPairs || 0),
    fullScanContinuationAt: scan.fullScanContinuationAt || null,
    fullScanContinuationError: scan.fullScanContinuationError || null,
    decisionLookupPairs: Number(scan.decisionLookupPairs || 0),
    decisionLookupQueries: Number(scan.decisionLookupQueries || 0),
    decisionLookupDurationMs: Number(scan.decisionLookupDurationMs || 0),
    decisionLookupAt: scan.decisionLookupAt || null,
    vectorEligible: Number(scan.vectorEligible || 0),
    vectorPendingBefore: Number(scan.vectorPendingBefore || 0),
    vectorProbes: Number(scan.vectorProbes || 0),
    vectorComparisons: Number(scan.vectorComparisons || 0),
    vectorMatchedComparisons: Number(scan.vectorMatchedComparisons || 0),
    vectorProbesWithMatches: Number(scan.vectorProbesWithMatches || 0),
    vectorRepresentedProbes: Number(scan.vectorRepresentedProbes || 0),
    vectorTruncated: Boolean(scan.vectorTruncated),
    vectorScanDurationMs: Number(scan.vectorScanDurationMs || 0),
    vectorPendingAfter: Number(scan.vectorPendingAfter || 0),
    vectorRetiredCandidates: Number(scan.vectorRetiredCandidates || 0),
    vectorCheckpointCommitted: Boolean(scan.vectorCheckpointCommitted),
    vectorContinuationAt: scan.vectorContinuationAt || null,
    vectorContinuationError: scan.vectorContinuationError || null,
    ...schedule
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

function nameScanSignals(entity: IdentityCandidateEntity): string[] {
  return [...new Set([entity.canonicalName, ...(entity.aliases || [])]
    .map(normalize).filter(value => value.length >= 2))].sort()
}

function encodeNameScanCursor(signal: string, leftId: string, rightId: string): string {
  return Buffer.from(JSON.stringify([signal, leftId, rightId]), 'utf8').toString('base64url')
}

function decodeNameScanCursor(cursor: string | null | undefined): [string, string, string] | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'string')
      ? value as [string, string, string] : null
  } catch {
    return null
  }
}

export function buildNameIdentityPairPage(
  entities: IdentityCandidateEntity[],
  options: { cursor?: string | null; limit?: number } = {}
): {
  pairKeys: string[]
  nextCursor: string | null
  hasMore: boolean
  cursorAccepted: boolean
  snapshotFingerprint: string
  stats: { people: number; nameBuckets: number; largestBucket: number }
} {
  const people = entities.filter(entity => entity.type === 'person')
  const signalByEntity = new Map(people.map(entity => [entity.id, nameScanSignals(entity)]))
  const buckets = new Map<string, string[]>()
  for (const entity of people) {
    for (const signal of signalByEntity.get(entity.id) || []) {
      buckets.set(signal, [...(buckets.get(signal) || []), entity.id])
    }
  }
  const orderedBuckets = [...buckets.entries()]
    .map(([signal, ids]) => [signal, [...new Set(ids)].sort()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  const snapshotFingerprint = createHash('sha256').update(JSON.stringify(people
    .map(entity => [entity.id, Number(entity.identityVersion || 1), signalByEntity.get(entity.id) || []])
    .sort(([left]: any, [right]: any) => String(left).localeCompare(String(right))))).digest('hex')
  const after = decodeNameScanCursor(options.cursor)
  const cursorAccepted = !options.cursor || Boolean(after && orderedBuckets.some(([signal, ids]) =>
    signal === after[0] && ids.indexOf(after[1]) >= 0 && ids.indexOf(after[2]) > ids.indexOf(after[1])))
  const effectiveAfter = cursorAccepted ? after : null
  const limit = Math.max(1, Math.min(100_000, Math.floor(options.limit || FULL_IDENTITY_SCAN_PAGE_SIZE)))
  const emitted: Array<{ pairKey: string; cursor: string }> = []
  let hasMore = false
  bucketLoop: for (const [signal, ids] of orderedBuckets) {
    const signalOrder = effectiveAfter ? signal.localeCompare(effectiveAfter[0]) : 1
    if (signalOrder < 0) continue
    let firstLeftIndex = 0
    let resumeRightIndex = -1
    if (effectiveAfter && signalOrder === 0) {
      firstLeftIndex = ids.indexOf(effectiveAfter[1])
      resumeRightIndex = ids.indexOf(effectiveAfter[2])
      if (firstLeftIndex < 0 || resumeRightIndex <= firstLeftIndex) continue
    }
    for (let leftIndex = firstLeftIndex; leftIndex < ids.length; leftIndex += 1) {
      const firstRightIndex = effectiveAfter && signalOrder === 0 && leftIndex === firstLeftIndex
        ? resumeRightIndex + 1 : leftIndex + 1
      for (let rightIndex = firstRightIndex; rightIndex < ids.length; rightIndex += 1) {
        const leftId = ids[leftIndex]
        const rightId = ids[rightIndex]
        const sharedSignals = (signalByEntity.get(leftId) || []).filter(value =>
          (signalByEntity.get(rightId) || []).includes(value))
        if (sharedSignals[0] !== signal) continue
        const tuple: [string, string, string] = [signal, leftId, rightId]
        if (emitted.length >= limit) {
          hasMore = true
          break bucketLoop
        }
        emitted.push({ pairKey: identityPairKey(leftId, rightId), cursor: encodeNameScanCursor(...tuple) })
      }
    }
  }
  return {
    pairKeys: emitted.map(item => item.pairKey),
    nextCursor: hasMore ? emitted.at(-1)?.cursor || null : null,
    hasMore,
    cursorAccepted,
    snapshotFingerprint,
    stats: {
      people: people.length,
      nameBuckets: orderedBuckets.length,
      largestBucket: orderedBuckets.reduce((largest, [, ids]) => Math.max(largest, ids.length), 0)
    }
  }
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
