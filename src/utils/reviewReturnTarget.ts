export type ReviewReturnTarget = {
  kind: 'project'
  projectId: string
  reviewId: string
}

export function buildProjectReviewReturnTarget(
  projectId: unknown,
  reviewId: unknown
): ReviewReturnTarget | null {
  const normalizedProjectId = String(projectId || '').trim()
  const normalizedReviewId = String(reviewId || '').trim()
  return normalizedProjectId && normalizedReviewId
    ? {
        kind: 'project',
        projectId: normalizedProjectId,
        reviewId: normalizedReviewId
      }
    : null
}

export function resolveCompletedReviewReturn(
  target: ReviewReturnTarget | null,
  completedReviewId: unknown
): string {
  const reviewId = String(completedReviewId || '').trim()
  return target?.kind === 'project' && target.reviewId === reviewId
    ? target.projectId
    : ''
}
