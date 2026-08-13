import { createHash } from 'node:crypto'

export const ENTITY_REJECTION_CASCADE_VERSION = 1
export const ENTITY_REJECTION_CLAIM_REASON = '关联实体已被用户拒绝，事实随之拒绝'
export const ENTITY_REJECTION_EVENT_REASON = '关联实体已被用户拒绝，事件随之拒绝'

function stableHash(value: unknown): string {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]))
    }
    return input
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

export type EntityRejectionCascadeSnapshot = {
  version: 1
  reviewId: string
  rejectedAt: string
  entity: {
    id: string
    canonicalName: string
    identityVersion: number
    previousTrustStatus: string
  }
  relations: Array<{
    id: string
    subjectId: string
    objectId: string
    previousStatus: string
  }>
  memories: Array<{
    kind: 'claim' | 'event'
    id: string
    previousStatus: string
    entityIds: string[]
  }>
  autoClosedReviewCount: number
}

export type EntityRejectionMemoryState = {
  kind: 'claim' | 'event'
  id: string
  status: string
  updatedAt: string
  latestDecision?: {
    previousStatus: string
    decision: string
    actor: string
    reason: string
    createdAt: string
  } | null
}

export function inspectEntityRejectionRestore(input: {
  snapshot: EntityRejectionCascadeSnapshot | null | undefined
  currentEntity?: any
  currentRelations?: any[]
  currentMemories?: EntityRejectionMemoryState[]
}): {
  safe: boolean
  reason: string
  currentFingerprint: string
  counts: { relations: number; claims: number; events: number; archivedReviews: number }
} {
  const snapshot = input.snapshot
  const counts = {
    relations: snapshot?.relations?.length || 0,
    claims: snapshot?.memories?.filter(item => item.kind === 'claim').length || 0,
    events: snapshot?.memories?.filter(item => item.kind === 'event').length || 0,
    archivedReviews: Math.max(0, Number(snapshot?.autoClosedReviewCount || 0))
  }
  if (!snapshot || snapshot.version !== ENTITY_REJECTION_CASCADE_VERSION ||
    !snapshot.reviewId || !snapshot.rejectedAt || !snapshot.entity?.id ||
    !Array.isArray(snapshot.relations) || !Array.isArray(snapshot.memories)) {
    return {
      safe: false,
      reason: '该历史拒绝发生在可逆快照上线前，不能安全自动恢复级联内容',
      currentFingerprint: stableHash({ invalid: true }),
      counts
    }
  }
  const entity = input.currentEntity
  const relations = new Map((input.currentRelations || []).map(item => [String(item?.id || ''), item]))
  const memories = new Map((input.currentMemories || []).map(item => [`${item.kind}:${item.id}`, item]))
  let reason = ''
  if (!entity || String(entity.id || '') !== snapshot.entity.id) {
    reason = '被拒绝实体已经不存在'
  } else if (String(entity.trustStatus || '') !== 'rejected') {
    reason = '实体可信状态已在拒绝后变化'
  } else if (String(entity.canonicalName || '') !== snapshot.entity.canonicalName ||
    Number(entity.identityVersion || 0) !== snapshot.entity.identityVersion) {
    reason = '实体名称或身份锚点已在拒绝后变化'
  } else if (String(entity.updatedAt || '') !== snapshot.rejectedAt) {
    reason = '实体档案已在拒绝后继续变化'
  }
  if (!reason) {
    for (const expected of snapshot.relations) {
      const current = relations.get(expected.id)
      if (!current) {
        reason = `关联关系 ${expected.id} 已经不存在`
        break
      }
      if (String(current.subjectId || '') !== expected.subjectId ||
        String(current.objectId || '') !== expected.objectId ||
        String(current.status || '') !== 'rejected' ||
        String(current.updatedAt || '') !== snapshot.rejectedAt) {
        reason = `关联关系 ${expected.id} 已在拒绝后变化`
        break
      }
    }
  }
  if (!reason) {
    for (const expected of snapshot.memories) {
      const current = memories.get(`${expected.kind}:${expected.id}`)
      const decision = current?.latestDecision
      const expectedReason = expected.kind === 'claim'
        ? ENTITY_REJECTION_CLAIM_REASON : ENTITY_REJECTION_EVENT_REASON
      if (!current) {
        reason = `${expected.kind === 'claim' ? '事实' : '事件'} ${expected.id} 已经不存在`
        break
      }
      if (current.status !== 'rejected' || decision?.decision !== 'rejected' ||
        decision?.actor !== 'system' || decision?.reason !== expectedReason ||
        decision?.createdAt !== snapshot.rejectedAt ||
        decision?.previousStatus !== expected.previousStatus) {
        reason = `${expected.kind === 'claim' ? '事实' : '事件'} ${expected.id} 已在拒绝后变化`
        break
      }
    }
  }
  const currentFingerprint = stableHash({
    snapshot,
    entity: entity ? {
      id: entity.id,
      canonicalName: entity.canonicalName,
      identityVersion: entity.identityVersion,
      trustStatus: entity.trustStatus,
      updatedAt: entity.updatedAt
    } : null,
    relations: snapshot.relations.map(expected => {
      const current = relations.get(expected.id)
      return current ? {
        id: current.id,
        subjectId: current.subjectId,
        objectId: current.objectId,
        status: current.status,
        updatedAt: current.updatedAt
      } : null
    }),
    memories: snapshot.memories.map(expected => memories.get(`${expected.kind}:${expected.id}`) || null)
  })
  return { safe: !reason, reason, currentFingerprint, counts }
}

export function buildEntityRejectionRestorePreviewToken(input: {
  reviewId: string
  graphReviewRevision: string
  structuredMemoryRevision: string
  currentFingerprint: string
}): string {
  return stableHash({
    action: 'restore_rejected_entity',
    reviewId: String(input.reviewId || ''),
    graphReviewRevision: String(input.graphReviewRevision || ''),
    structuredMemoryRevision: String(input.structuredMemoryRevision || ''),
    currentFingerprint: String(input.currentFingerprint || '')
  })
}

export function assertEntityRejectionRestoreConfirmation(
  expected: {
    reviewId: string
    graphReviewRevision: string
    structuredMemoryRevision: string
    currentFingerprint: string
  },
  input: { previewToken?: string; confirmation?: string }
): void {
  if (String(input.confirmation || '') !== '恢复身份' ||
    String(input.previewToken || '') !== buildEntityRejectionRestorePreviewToken(expected)) {
    throw new Error('身份恢复确认已失效，请重新核对')
  }
}

export function restoredCascadeStatus(
  previousStatus: string,
  relatedEntityIds: string[],
  trustedEntityIds: Set<string>
): string {
  if (previousStatus !== 'confirmed') return previousStatus
  return (relatedEntityIds || []).some(entityId => !trustedEntityIds.has(entityId))
    ? 'candidate' : 'confirmed'
}

export type EntityRejectionRestorePlan = {
  entityId: string
  relations: Array<{ id: string; status: string }>
  memories: Array<{
    kind: 'claim' | 'event'
    id: string
    status: string
    write: boolean
  }>
  downgraded: number
}

export function buildEntityRejectionRestorePlan(input: {
  snapshot: EntityRejectionCascadeSnapshot
  currentRelations: any[]
  trustedEntityIds: Set<string>
}): EntityRejectionRestorePlan {
  const trustedEntityIds = new Set(input.trustedEntityIds)
  trustedEntityIds.add(input.snapshot.entity.id)
  const currentRelations = new Map(
    (input.currentRelations || []).map(relation => [String(relation?.id || ''), relation])
  )
  let downgraded = 0
  const relations = input.snapshot.relations.map(expected => {
    const relation = currentRelations.get(expected.id)
    if (!relation || String(relation.subjectId || '') !== expected.subjectId ||
      String(relation.objectId || '') !== expected.objectId) {
      throw new Error(`关联关系 ${expected.id} 已变化，不能生成身份恢复计划`)
    }
    const status = restoredCascadeStatus(
      expected.previousStatus,
      [expected.subjectId, expected.objectId],
      trustedEntityIds
    )
    if (status !== expected.previousStatus) downgraded += 1
    return { id: expected.id, status }
  })
  const memories = input.snapshot.memories.map(expected => {
    const status = restoredCascadeStatus(
      expected.previousStatus,
      expected.entityIds || [],
      trustedEntityIds
    )
    if (status !== expected.previousStatus) downgraded += 1
    return {
      kind: expected.kind,
      id: expected.id,
      status,
      write: status !== 'rejected'
    }
  })
  return {
    entityId: input.snapshot.entity.id,
    relations,
    memories,
    downgraded
  }
}
