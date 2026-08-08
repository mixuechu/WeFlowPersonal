import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calibrationReviewDrilldown,
  type CalibrationReviewTarget
} from '../src/utils/calibrationReviewDrilldown.ts'

test('calibration review drilldown always opens the resolved authoritative ledger', () => {
  const expectedKinds: Record<CalibrationReviewTarget, string> = {
    identity: 'possible_duplicate',
    relation: 'relation',
    entity_creation: 'entity_creation',
    entity_summary: 'entity_summary',
    entity_alias: 'entity_alias'
  }
  for (const [target, kind] of Object.entries(expectedKinds)) {
    assert.deepEqual(calibrationReviewDrilldown(target as CalibrationReviewTarget), {
      sectionId: 'graph-review-ledger',
      status: 'resolved',
      kind,
      query: '',
      calibrationOutcome: ''
    })
  }
})

test('calibration review drilldown preserves an exact server-side outcome scope', () => {
  assert.equal(calibrationReviewDrilldown('relation', 'exact').calibrationOutcome, 'exact')
  assert.equal(calibrationReviewDrilldown('entity_summary', 'corrected').calibrationOutcome, 'corrected')
  assert.equal(calibrationReviewDrilldown('identity', 'rejected').calibrationOutcome, 'rejected')
})
