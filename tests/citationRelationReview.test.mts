import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCitationRelationCorrection,
  applyCitationRelationDecision,
  resolveCitationRelationCorrectionReviews
} from '../electron/services/citationRelationReview.ts'
import { runReversibleGraphMutation } from '../electron/services/graphReviewMutationPolicy.ts'
import {
  planRelationConfirmation,
  relationSemanticId
} from '../electron/services/relationCorrectionPolicy.ts'

const graphFixture = () => ({
  relations: [{
    id: 'relation-one',
    status: 'candidate',
    updatedAt: 'before'
  }],
  reviewQueue: [{
    id: 'review-one',
    kind: 'relation',
    relationId: 'relation-one',
    status: 'pending'
  }]
})

test('citation relation decision resolves the relation and matching pending reviews together', () => {
  const graph = graphFixture()
  const relation = applyCitationRelationDecision(
    graph,
    'relation-one',
    'confirmed',
    '2026-08-05T01:00:00.000Z'
  )
  assert.equal(relation?.status, 'confirmed')
  assert.deepEqual(graph.reviewQueue[0], {
    id: 'review-one',
    kind: 'relation',
    relationId: 'relation-one',
    status: 'confirmed',
    resolvedAt: '2026-08-05T01:00:00.000Z',
    resolutionActor: 'user',
    resolutionReason: '用户在统一记忆中确认关系'
  })
})

test('citation relation decision is restored when the authoritative commit fails', () => {
  let graph = graphFixture()
  let persisted: any = null
  assert.throws(() => runReversibleGraphMutation({
    snapshot: structuredClone(graph),
    transact: apply => apply(),
    apply: () => {
      applyCitationRelationDecision(
        graph,
        'relation-one',
        'rejected',
        '2026-08-05T01:00:00.000Z'
      )
      throw new Error('injected citation relation commit failure')
    },
    restore: snapshot => { graph = snapshot },
    persistRestored: () => { persisted = structuredClone(graph) }
  }), /injected citation relation commit failure/)
  assert.equal(graph.relations[0].status, 'candidate')
  assert.equal(graph.reviewQueue[0].status, 'pending')
  assert.deepEqual(persisted, graph)
})

test('citation relation correction resolves the source review and closes duplicate candidates', () => {
  const graph = {
    reviewQueue: [{
      id: 'source-review',
      kind: 'relation',
      relationId: 'before-relation',
      status: 'pending'
    }, {
      id: 'duplicate-review',
      kind: 'relation',
      relationId: 'after-relation',
      status: 'pending'
    }, {
      id: 'unrelated-review',
      kind: 'relation',
      relationId: 'other-relation',
      status: 'pending'
    }]
  }
  resolveCitationRelationCorrectionReviews(
    graph,
    'before-relation',
    'after-relation',
    '2026-08-05T02:00:00.000Z'
  )
  assert.deepEqual(graph.reviewQueue[0], {
    id: 'source-review',
    kind: 'relation',
    relationId: 'after-relation',
    status: 'confirmed',
    originalRelationId: 'before-relation',
    correctedRelationId: 'after-relation',
    resolvedAt: '2026-08-05T02:00:00.000Z',
    resolutionActor: 'user',
    resolutionReason: '用户在回答引用中纠正并确认关系'
  })
  assert.equal(graph.reviewQueue[1].status, 'rejected')
  assert.equal(graph.reviewQueue[1].resolutionActor, 'system')
  assert.equal(graph.reviewQueue[2].status, 'pending')
})

test('citation relation correction rolls back the corrected edge and reviews together', () => {
  const entities = [
    { id: 'person', type: 'person', canonicalName: '邢爱妮', trustStatus: 'confirmed' },
    { id: 'org', type: 'organization', canonicalName: 'Onyx Devs Lab', trustStatus: 'confirmed' }
  ]
  const beforeId = relationSemanticId('org', '服务对象', 'person')
  const relation = {
    id: beforeId,
    subjectId: 'org',
    predicate: '服务对象',
    objectId: 'person',
    evidence: [{
      sourceId: 'wechat',
      sessionId: 'session-a',
      messageId: 'message-1',
      excerpt: '原文'
    }],
    confidence: 0.8,
    status: 'confirmed'
  }
  const plan = planRelationConfirmation({
    review: { kind: 'relation', relationId: beforeId },
    relation,
    entities,
    correction: {
      subjectId: 'person',
      predicate: '服务于',
      objectId: 'org'
    }
  })
  let graph: any = {
    entities,
    relations: [relation],
    reviewQueue: [{
      id: 'pending-source',
      kind: 'relation',
      relationId: beforeId,
      status: 'pending'
    }]
  }
  let persisted: any = null
  assert.throws(() => runReversibleGraphMutation({
    snapshot: structuredClone(graph),
    transact: apply => apply(),
    apply: () => {
      applyCitationRelationCorrection(
        graph,
        beforeId,
        plan,
        '2026-08-05T03:00:00.000Z'
      )
      throw new Error('injected citation correction audit failure')
    },
    restore: snapshot => { graph = snapshot },
    persistRestored: () => { persisted = structuredClone(graph) }
  }), /injected citation correction audit failure/)
  assert.equal(graph.relations[0].id, beforeId)
  assert.equal(graph.relations[0].subjectId, 'org')
  assert.equal(graph.reviewQueue[0].status, 'pending')
  assert.deepEqual(persisted, graph)
})
