import { createHash } from 'node:crypto'

function stableHash(value: unknown): string {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input).sort().map(key => [key, normalize(input[key])])
      )
    }
    return input
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

function uniqueSorted(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
}

function entityIdentity(entity: any): any {
  const summaryStatus = String(entity?.summaryStatus || '')
  return {
    id: String(entity?.id || ''),
    type: String(entity?.type || ''),
    canonicalName: String(entity?.canonicalName || ''),
    aliases: uniqueSorted(entity?.aliases || []),
    accountIds: uniqueSorted(entity?.accountIds || []),
    externalIdentities: (entity?.externalIdentities || [])
      .map((item: any) => `${String(item?.platform || '').toLowerCase()}:${String(item?.accountId || '').toLowerCase()}`)
      .filter(Boolean).sort(),
    summary: summaryStatus === 'confirmed' ? String(entity?.summary || '') : '',
    summaryStatus,
    confidence: Number(entity?.confidence || 0),
    identityVersion: Number(entity?.identityVersion || 0),
    trustStatus: String(entity?.trustStatus || '')
  }
}

function relationIdentity(relation: any): any {
  return {
    id: String(relation?.id || ''),
    subjectId: String(relation?.subjectId || ''),
    predicate: String(relation?.predicate || ''),
    objectId: String(relation?.objectId || ''),
    status: String(relation?.status || ''),
    confidence: Number(relation?.confidence || 0),
    evidenceTotal: Math.max(
      Number(relation?.evidenceTotal || 0),
      Number(relation?.evidence?.length || 0)
    )
  }
}

function participantIdentity(items: any[]): string[] {
  return uniqueSorted((items || []).map(item =>
    `${String(item?.eventId || item?.event_id || '')}\0${String(item?.role || '')}`))
}

export function buildExpectedMergedTarget(source: any, target: any): any {
  const identities = new Map<string, any>()
  for (const identity of [...(target?.externalIdentities || []), ...(source?.externalIdentities || [])]) {
    identities.set(
      `${String(identity?.platform || '').toLowerCase()}:${String(identity?.accountId || '').toLowerCase()}`,
      identity
    )
  }
  const summary = target?.summary || source?.summary
  return {
    ...target,
    aliases: [...new Set([
      ...(target?.aliases || []),
      source?.canonicalName,
      ...(source?.aliases || [])
    ])].filter(alias => alias && alias !== target?.canonicalName),
    accountIds: [...new Set([...(target?.accountIds || []), ...(source?.accountIds || [])])],
    externalIdentities: [...identities.values()],
    evidenceMessageIds: [...new Set([
      ...(target?.evidenceMessageIds || []),
      ...(source?.evidenceMessageIds || [])
    ])],
    summary,
    summaryStatus: summary === source?.summary ? source?.summaryStatus : target?.summaryStatus,
    confidence: Math.max(Number(target?.confidence || 0), Number(source?.confidence || 0)),
    identityVersion: Number(target?.identityVersion || 0) + 1,
    trustStatus: 'confirmed'
  }
}

export function buildExpectedMergedRelations(
  relations: any[],
  sourceId: string,
  targetId: string
): any[] {
  const normalized = new Map<string, any>()
  for (const original of relations || []) {
    const relation = {
      ...original,
      subjectId: original.subjectId === sourceId ? targetId : original.subjectId,
      objectId: original.objectId === sourceId ? targetId : original.objectId
    }
    if (relation.subjectId === relation.objectId) continue
    const id = createHash('sha256')
      .update(`${relation.subjectId}|${relation.predicate}|${relation.objectId}`)
      .digest('hex').slice(0, 20)
    const existing = normalized.get(id)
    if (existing) {
      const knownMessageIds = new Set((existing.evidence || []).map((item: any) => String(item.messageId || '')))
      existing.evidence.push(...(relation.evidence || []).filter((item: any) =>
        !knownMessageIds.has(String(item.messageId || ''))))
      existing.evidenceTotal = existing.evidence.length
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(relation.confidence || 0))
    } else {
      normalized.set(id, {
        ...relation,
        id,
        evidenceTotal: Math.max(
          Number(relation.evidenceTotal || 0),
          Number(relation.evidence?.length || 0)
        )
      })
    }
  }
  return [...normalized.values()]
}

export function inspectIdentityMergeRevert(input: {
  snapshot: any
  currentGraph: { entities: any[]; relations: any[]; reviewQueue: any[] }
  currentSourceParticipants?: any[]
  currentTargetParticipants?: any[]
  currentIdentityDecision?: any
}): {
  safe: boolean
  reason: string
  currentFingerprint: string
  counts: { relations: number; reviews: number; eventParticipants: number }
} {
  const snapshot = input.snapshot || {}
  const source = snapshot.source
  const target = snapshot.target
  if (!source?.id || !target?.id || !Array.isArray(snapshot.relations)) {
    return {
      safe: false,
      reason: '该合并缺少完整可逆快照',
      currentFingerprint: stableHash({ invalid: true }),
      counts: { relations: 0, reviews: 0, eventParticipants: 0 }
    }
  }
  const currentSource = input.currentGraph.entities.find(entity => entity.id === source.id)
  const currentTarget = input.currentGraph.entities.find(entity => entity.id === target.id)
  const expectedTarget = buildExpectedMergedTarget(source, target)
  const expectedRelations = buildExpectedMergedRelations(snapshot.relations, source.id, target.id)
    .filter(relation => relation.subjectId === target.id || relation.objectId === target.id)
    .map(relationIdentity).sort((a, b) => a.id.localeCompare(b.id))
  const currentRelations = input.currentGraph.relations
    .filter(relation =>
      relation.subjectId === source.id || relation.objectId === source.id ||
      relation.subjectId === target.id || relation.objectId === target.id)
    .map(relationIdentity).sort((a, b) => a.id.localeCompare(b.id))
  const expectedTargetParticipants = participantIdentity([
    ...(snapshot.sourceEventParticipants || []),
    ...(snapshot.targetEventParticipants || [])
  ])
  const currentSourceParticipants = participantIdentity(input.currentSourceParticipants || [])
  const currentTargetParticipants = participantIdentity(input.currentTargetParticipants || [])
  const affectedReviewIds = new Set((snapshot.affectedReviews || []).map((review: any) => String(review.id || '')))
  const currentReviews = input.currentGraph.reviewQueue
    .filter(review => affectedReviewIds.has(String(review.id || '')))
    .map(review => ({
      id: String(review.id || ''),
      kind: String(review.kind || ''),
      status: String(review.status || ''),
      mergeSourceEntityId: String(review.mergeSourceEntityId || ''),
      mergeTargetEntityId: String(review.mergeTargetEntityId || '')
    })).sort((a, b) => a.id.localeCompare(b.id))
  const fingerprintPayload = {
    source: currentSource ? entityIdentity(currentSource) : null,
    target: currentTarget ? entityIdentity(currentTarget) : null,
    relations: currentRelations,
    reviews: currentReviews,
    sourceParticipants: currentSourceParticipants,
    targetParticipants: currentTargetParticipants,
    identityDecision: input.currentIdentityDecision ? {
      decision: String(input.currentIdentityDecision.decision || ''),
      leftEntityId: String(input.currentIdentityDecision.left_entity_id || ''),
      rightEntityId: String(input.currentIdentityDecision.right_entity_id || ''),
      leftVersion: Number(input.currentIdentityDecision.left_version || 0),
      rightVersion: Number(input.currentIdentityDecision.right_version || 0)
    } : null
  }
  let reason = ''
  if (currentSource) reason = '被合并身份已经重新出现，不能覆盖其后续档案'
  else if (!currentTarget) reason = '保留身份已经不存在'
  else if (stableHash(entityIdentity(currentTarget)) !== stableHash(entityIdentity(expectedTarget))) {
    reason = '保留身份在合并后已有新的名称、账号、摘要或证据变化'
  } else if (stableHash(currentRelations) !== stableHash(expectedRelations)) {
    reason = '相关关系在合并后已有新增或变化'
  } else if (currentSourceParticipants.length ||
    stableHash(currentTargetParticipants) !== stableHash(expectedTargetParticipants)) {
    reason = '相关事件参与关系在合并后已有变化'
  } else if (currentReviews.length !== affectedReviewIds.size) {
    reason = '相关身份审阅记录在合并后已有变化'
  } else if (currentReviews.some(review =>
    review.kind === 'possible_duplicate'
      ? review.status !== 'confirmed' ||
        review.mergeSourceEntityId !== source.id ||
        review.mergeTargetEntityId !== target.id
      : review.status !== 'rejected')) {
    reason = '相关身份审阅决定在合并后已有变化'
  } else if (String(input.currentIdentityDecision?.decision || '') !== 'merged') {
    reason = '身份消歧决定在合并后已有变化'
  }
  return {
    safe: !reason,
    reason,
    currentFingerprint: stableHash(fingerprintPayload),
    counts: {
      relations: expectedRelations.length,
      reviews: affectedReviewIds.size,
      eventParticipants: participantIdentity(snapshot.sourceEventParticipants || []).length
    }
  }
}

export function buildIdentityMergeRevertPreviewToken(input: {
  mergeId: number
  archiveRevision: string
  currentFingerprint: string
}): string {
  return stableHash({
    action: 'revert_identity_merge',
    mergeId: Number(input.mergeId || 0),
    archiveRevision: String(input.archiveRevision || ''),
    currentFingerprint: String(input.currentFingerprint || '')
  })
}

export function assertIdentityMergeRevertConfirmation(
  expected: { mergeId: number; archiveRevision: string; currentFingerprint: string },
  input: { previewToken?: string; confirmation?: string }
): void {
  if (String(input.confirmation || '') !== '撤销合并' ||
    String(input.previewToken || '') !== buildIdentityMergeRevertPreviewToken(expected)) {
    throw new Error('身份合并撤销确认已失效，请重新核对')
  }
}

export function restoreIdentityMergeGraph(
  snapshot: any,
  currentGraph: { entities: any[]; relations: any[]; reviewQueue: any[] }
): { entities: any[]; relations: any[]; reviewQueue: any[] } {
  const sourceId = String(snapshot?.source?.id || '')
  const targetId = String(snapshot?.target?.id || '')
  const affectedReviewIds = new Set(
    (snapshot?.affectedReviews || []).map((review: any) => String(review?.id || ''))
  )
  return {
    entities: (currentGraph.entities || [])
      .filter(entity => entity.id !== sourceId && entity.id !== targetId)
      .concat([snapshot.source, snapshot.target]),
    relations: (currentGraph.relations || [])
      .filter(relation =>
        relation.subjectId !== sourceId &&
        relation.objectId !== sourceId &&
        relation.subjectId !== targetId &&
        relation.objectId !== targetId)
      .concat((snapshot.relations || []).filter((relation: any) =>
        relation.subjectId === sourceId ||
        relation.objectId === sourceId ||
        relation.subjectId === targetId ||
        relation.objectId === targetId)),
    reviewQueue: (currentGraph.reviewQueue || [])
      .filter(review => !affectedReviewIds.has(String(review.id || '')))
      .concat(snapshot.affectedReviews || [])
  }
}
