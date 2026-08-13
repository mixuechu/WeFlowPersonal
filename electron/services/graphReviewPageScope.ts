import crypto from 'node:crypto'
import type {
  GraphReviewPageOptions,
  ReviewCalibrationOutcomeFilter,
  ReviewStatusFilter
} from '../../shared/graphReviewPagination.ts'

export type NormalizedGraphReviewPageScope = {
  status: ReviewStatusFilter
  kind: string
  query: string
  reviewId: string
  entityId: string
  calibrationOutcome: ReviewCalibrationOutcomeFilter
  reasonCode: string
}

export function normalizeGraphReviewPageScope(
  options: Partial<GraphReviewPageOptions> = {}
): NormalizedGraphReviewPageScope {
  const status = options.status === 'resolved' || options.status === 'all'
    ? options.status
    : 'pending'
  const calibrationInput = String(options.calibrationOutcome || '')
  const calibrationOutcome = ['exact', 'corrected', 'rejected'].includes(calibrationInput)
    ? calibrationInput as ReviewCalibrationOutcomeFilter
    : ''
  return {
    status,
    kind: String(options.kind || '').trim(),
    query: String(options.query || '').trim().toLocaleLowerCase('zh-CN'),
    reviewId: String(options.reviewId || '').trim(),
    entityId: String(options.entityId || '').trim(),
    calibrationOutcome,
    reasonCode: String(options.reasonCode || '').trim()
  }
}

export function buildGraphReviewPageScopeToken(
  options: Partial<GraphReviewPageOptions> = {}
): { token: string; scope: NormalizedGraphReviewPageScope } {
  const scope = normalizeGraphReviewPageScope(options)
  const token = crypto.createHash('sha256').update(JSON.stringify([
    'graph-review-page-scope-v1',
    scope
  ])).digest('hex')
  return { token, scope }
}
