export type CalibrationReviewTarget =
  | 'identity'
  | 'relation'
  | 'entity_creation'
  | 'entity_summary'
  | 'entity_alias'

export type CalibrationReviewDrilldown = {
  sectionId: 'graph-review-ledger'
  status: 'resolved'
  kind: 'possible_duplicate' | 'relation' | 'entity_creation' | 'entity_summary' | 'entity_alias'
  query: ''
  calibrationOutcome: '' | 'exact' | 'corrected' | 'rejected'
}

export function calibrationReviewDrilldown(
  target: CalibrationReviewTarget,
  calibrationOutcome: CalibrationReviewDrilldown['calibrationOutcome'] = ''
): CalibrationReviewDrilldown {
  return {
    sectionId: 'graph-review-ledger',
    status: 'resolved',
    kind: target === 'identity' ? 'possible_duplicate' : target,
    query: '',
    calibrationOutcome
  }
}
