import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCitationRelationDecision } from '../electron/services/citationRelationReview.ts'
import { runReversibleGraphMutation } from '../electron/services/graphReviewMutationPolicy.ts'

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
