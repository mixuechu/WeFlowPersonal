export type ReviewReturnTarget =
  | {
      kind: 'project'
      sourceId: string
      reviewId: string
    }
  | {
      kind: 'entity'
      sourceId: string
      reviewId: string
    }

function buildReviewReturnTarget(
  kind: ReviewReturnTarget['kind'],
  sourceId: unknown,
  reviewId: unknown
): ReviewReturnTarget | null {
  const normalizedSourceId = String(sourceId || '').trim()
  const normalizedReviewId = String(reviewId || '').trim()
  return normalizedSourceId && normalizedReviewId
    ? { kind, sourceId: normalizedSourceId, reviewId: normalizedReviewId }
    : null
}

export function buildProjectReviewReturnTarget(
  projectId: unknown,
  reviewId: unknown
): ReviewReturnTarget | null {
  return buildReviewReturnTarget('project', projectId, reviewId)
}

export function buildEntityReviewReturnTarget(
  entityId: unknown,
  reviewId: unknown
): ReviewReturnTarget | null {
  return buildReviewReturnTarget('entity', entityId, reviewId)
}

export function resolveCompletedReviewReturn(
  target: ReviewReturnTarget | null,
  completedReviewId: unknown
): ReviewReturnTarget | null {
  const reviewId = String(completedReviewId || '').trim()
  return target?.reviewId === reviewId ? target : null
}

export function isSameReviewReturnTarget(
  left: ReviewReturnTarget | null,
  right: ReviewReturnTarget | null
): boolean {
  return !!left && !!right &&
    left.kind === right.kind &&
    left.sourceId === right.sourceId &&
    left.reviewId === right.reviewId
}
