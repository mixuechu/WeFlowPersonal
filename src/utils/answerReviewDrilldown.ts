export type AnswerReviewDrilldownTarget =
  | 'pending'
  | 'resolved'
  | 'attention'
  | 'invalid'
  | 'needs_review'
  | 'current'

export type AnswerReviewDrilldownFilters = {
  status: 'attention' | 'invalid' | 'needs_review' | 'current' | 'all'
  reviewState: 'pending' | 'resolved' | 'all'
  invalidReason: ''
}

export function answerReviewDrilldownFilters(
  target: AnswerReviewDrilldownTarget
): AnswerReviewDrilldownFilters {
  if (target === 'pending' || target === 'resolved') {
    return {
      status: 'attention',
      reviewState: target,
      invalidReason: ''
    }
  }
  return {
    status: target === 'attention' ? 'attention' : target,
    reviewState: 'all',
    invalidReason: ''
  }
}
