import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewInbox } from '../shared/reviewInbox.ts'

test('review inbox prioritizes trusted contradictions and preserves exact totals', () => {
  const inbox = buildReviewInbox({
    confirmedConflicts: 2,
    taskOwnership: 3,
    graphPending: 5,
    candidateClaims: 7,
    candidateEvents: 11
  })
  assert.equal(inbox.total, 28)
  assert.deepEqual(inbox.items.map(item => item.target), [
    'confirmed_conflicts',
    'task_ownership',
    'graph_identity',
    'candidate_claims',
    'candidate_events'
  ])
  assert.equal(inbox.items[0].severity, 'warning')
})

test('review inbox clamps invalid backend counts instead of inventing work', () => {
  const inbox = buildReviewInbox({
    confirmedConflicts: -4,
    taskOwnership: Number.NaN,
    graphPending: 1.9
  })
  assert.equal(inbox.total, 1)
  assert.deepEqual(inbox.items.map(item => item.count), [0, 0, 1, 0, 0])
})
