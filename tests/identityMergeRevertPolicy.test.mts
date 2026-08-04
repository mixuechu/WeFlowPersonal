import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertIdentityMergeRevertConfirmation,
  buildExpectedMergedRelations,
  buildExpectedMergedTarget,
  buildIdentityMergeRevertPreviewToken,
  inspectIdentityMergeRevert,
  restoreIdentityMergeGraph
} from '../electron/services/identityMergeRevertPolicy.ts'
import {
  IDENTITY_MERGE_SNAPSHOT_VERSION,
  compactIdentityMergeSnapshot
} from '../electron/services/identityMergeSnapshot.ts'

function fixture() {
  const source = {
    id: 'source', type: 'person', canonicalName: '甲', aliases: ['小甲'],
    accountIds: ['wx-a'], externalIdentities: [], evidenceMessageIds: ['m-a'],
    summary: '甲档案', summaryStatus: 'confirmed', confidence: 0.8,
    identityVersion: 2, trustStatus: 'confirmed'
  }
  const target = {
    id: 'target', type: 'person', canonicalName: '乙', aliases: ['小乙'],
    accountIds: ['wx-b'], externalIdentities: [], evidenceMessageIds: ['m-b'],
    summary: '乙档案', summaryStatus: 'confirmed', confidence: 0.9,
    identityVersion: 4, trustStatus: 'confirmed'
  }
  const unrelated = {
    id: 'other', type: 'person', canonicalName: '丙', aliases: [],
    accountIds: [], externalIdentities: [], evidenceMessageIds: [],
    summary: '', summaryStatus: 'empty', confidence: 1,
    identityVersion: 1, trustStatus: 'confirmed'
  }
  const relations = [{
    id: 'old-source-edge', subjectId: 'source', predicate: '合作', objectId: 'other',
    status: 'confirmed', confidence: 0.8,
    evidence: [{ sourceId: 'wechat', sessionId: 's', messageId: 'm1', timestamp: 1, excerpt: '合作' }]
  }, {
    id: 'unrelated-edge', subjectId: 'other', predicate: '属于', objectId: 'fourth',
    status: 'confirmed', confidence: 0.7, evidence: []
  }]
  const affectedReviews = [{
    id: 'merge-review', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'source', rightEntityId: 'target'
  }, {
    id: 'source-alias-review', kind: 'entity_alias', status: 'pending', entityId: 'source'
  }]
  const snapshot = {
    source, target, relations, affectedReviews,
    sourceEventParticipants: [{ eventId: 'event-a', role: '参与者' }],
    targetEventParticipants: [{ eventId: 'event-b', role: '参与者' }]
  }
  const mergedRelations = buildExpectedMergedRelations(relations, 'source', 'target')
  return {
    snapshot,
    currentGraph: {
      entities: [buildExpectedMergedTarget(source, target), unrelated, {
        id: 'fourth', type: 'organization', canonicalName: '机构', aliases: [],
        accountIds: [], externalIdentities: [], evidenceMessageIds: [],
        summary: '', summaryStatus: 'empty', confidence: 1,
        identityVersion: 1, trustStatus: 'confirmed'
      }],
      relations: mergedRelations,
      reviewQueue: [{
        ...affectedReviews[0], status: 'confirmed',
        mergeSourceEntityId: 'source', mergeTargetEntityId: 'target'
      }, { ...affectedReviews[1], status: 'rejected' }]
    },
    sourceParticipants: [],
    targetParticipants: [
      { eventId: 'event-a', role: '参与者' },
      { eventId: 'event-b', role: '参与者' }
    ],
    identityDecision: {
      decision: 'merged',
      left_entity_id: 'source',
      right_entity_id: 'target',
      left_version: 2,
      right_version: 4
    }
  }
}

test('identity merge revert accepts an unchanged merge and binds its preview', () => {
  const input = fixture()
  const inspection = inspectIdentityMergeRevert({
    snapshot: input.snapshot,
    currentGraph: input.currentGraph,
    currentSourceParticipants: input.sourceParticipants,
    currentTargetParticipants: input.targetParticipants,
    currentIdentityDecision: input.identityDecision
  })
  assert.equal(inspection.safe, true)
  const expected = {
    mergeId: 7,
    archiveRevision: '12',
    currentFingerprint: inspection.currentFingerprint
  }
  const previewToken = buildIdentityMergeRevertPreviewToken(expected)
  assert.doesNotThrow(() =>
    assertIdentityMergeRevertConfirmation(expected, { previewToken, confirmation: '撤销合并' }))
  assert.throws(() =>
    assertIdentityMergeRevertConfirmation(expected, { previewToken, confirmation: '确认' }), /确认已失效/)
})

test('identity merge revert rejects post-merge identity, relation and participant changes', () => {
  const identityChanged = fixture()
  identityChanged.currentGraph.entities[0].aliases.push('合并后新增')
  assert.match(inspectIdentityMergeRevert({
    snapshot: identityChanged.snapshot,
    currentGraph: identityChanged.currentGraph,
    currentSourceParticipants: [],
    currentTargetParticipants: identityChanged.targetParticipants,
    currentIdentityDecision: identityChanged.identityDecision
  }).reason, /身份在合并后已有/)

  const relationChanged = fixture()
  relationChanged.currentGraph.relations.push({
    id: 'new-edge', subjectId: 'target', predicate: '新增', objectId: 'other',
    status: 'confirmed', confidence: 1, evidence: []
  })
  assert.match(inspectIdentityMergeRevert({
    snapshot: relationChanged.snapshot,
    currentGraph: relationChanged.currentGraph,
    currentSourceParticipants: [],
    currentTargetParticipants: relationChanged.targetParticipants,
    currentIdentityDecision: relationChanged.identityDecision
  }).reason, /关系在合并后已有/)

  const participantsChanged = fixture()
  participantsChanged.targetParticipants.push({ eventId: 'event-c', role: '参与者' })
  assert.match(inspectIdentityMergeRevert({
    snapshot: participantsChanged.snapshot,
    currentGraph: participantsChanged.currentGraph,
    currentSourceParticipants: [],
    currentTargetParticipants: participantsChanged.targetParticipants,
    currentIdentityDecision: participantsChanged.identityDecision
  }).reason, /事件参与关系/)
})

test('identity merge restore preserves unrelated graph changes', () => {
  const input = fixture()
  input.currentGraph.relations.push({
    id: 'later-unrelated', subjectId: 'other', predicate: '新增', objectId: 'fourth',
    status: 'confirmed', confidence: 1, evidence: []
  })
  input.currentGraph.reviewQueue.push({
    id: 'unrelated-review', kind: 'entity_alias', status: 'pending', entityId: 'other'
  })
  const restored = restoreIdentityMergeGraph(input.snapshot, input.currentGraph)
  assert.ok(restored.entities.some(entity => entity.id === 'source'))
  assert.ok(restored.entities.some(entity => entity.id === 'target'))
  assert.ok(restored.relations.some(relation => relation.id === 'later-unrelated'))
  assert.ok(restored.relations.some(relation => relation.id === 'old-source-edge'))
  assert.ok(restored.reviewQueue.some(review => review.id === 'unrelated-review'))
  assert.equal(restored.reviewQueue.find(review => review.id === 'merge-review')?.status, 'pending')
})

test('identity merge snapshot keeps only affected reversible state at graph scale', () => {
  const input = fixture()
  input.snapshot.relations.push(...Array.from({ length: 10_000 }, (_, index) => ({
    id: `unrelated-${index}`,
    subjectId: `unrelated-left-${index}`,
    predicate: '无关',
    objectId: `unrelated-right-${index}`,
    evidence: [{ messageId: `irrelevant-${index}`, excerpt: '不应复制到身份合并快照' }]
  })))
  input.snapshot.unexpectedFullGraphCopy = { entities: Array(10_000).fill('private') }
  const compacted = compactIdentityMergeSnapshot(input.snapshot)
  assert.equal(compacted.valid, true)
  assert.equal(compacted.snapshot.version, IDENTITY_MERGE_SNAPSHOT_VERSION)
  assert.equal(compacted.originalRelations, 10_002)
  assert.equal(compacted.retainedRelations, 1)
  assert.equal('unexpectedFullGraphCopy' in compacted.snapshot, false)
  assert.deepEqual(compacted.snapshot.sourceEventParticipants, input.snapshot.sourceEventParticipants)
  assert.deepEqual(compacted.snapshot.affectedReviews, input.snapshot.affectedReviews)

  const inspection = inspectIdentityMergeRevert({
    snapshot: compacted.snapshot,
    currentGraph: input.currentGraph,
    currentSourceParticipants: input.sourceParticipants,
    currentTargetParticipants: input.targetParticipants,
    currentIdentityDecision: input.identityDecision
  })
  assert.equal(inspection.safe, true)
  const restored = restoreIdentityMergeGraph(compacted.snapshot, input.currentGraph)
  assert.ok(restored.relations.some(relation => relation.id === 'old-source-edge'))
  assert.ok(restored.relations.some(relation =>
    relation.subjectId === 'other' && relation.objectId === 'fourth'))
})
