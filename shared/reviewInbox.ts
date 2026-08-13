export type ReviewInboxTarget =
  | 'confirmed_conflicts'
  | 'task_ownership'
  | 'graph_identity'
  | 'candidate_claims'
  | 'candidate_events'

export type ReviewInboxItem = {
  target: ReviewInboxTarget
  label: string
  detail: string
  count: number
  severity: 'warning' | 'normal'
}

export function buildReviewInbox(input: {
  confirmedConflicts?: number
  taskOwnership?: number
  graphPending?: number
  candidateClaims?: number
  candidateEvents?: number
}): { items: ReviewInboxItem[]; total: number } {
  const count = (value: unknown) =>
    Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0)
  const items: ReviewInboxItem[] = [{
    target: 'confirmed_conflicts',
    label: '已确认但含反证',
    detail: '可能影响问答结论，优先裁决',
    count: count(input.confirmedConflicts),
    severity: 'warning'
  }, {
    target: 'task_ownership',
    label: '待确认任务归属',
    detail: '尚未计入你的行动清单',
    count: count(input.taskOwnership),
    severity: 'normal'
  }, {
    target: 'graph_identity',
    label: '身份与关系候选',
    detail: '合并、实体、别名、摘要和关系',
    count: count(input.graphPending),
    severity: 'normal'
  }, {
    target: 'candidate_claims',
    label: '候选事实',
    detail: '确认后才能成为可信记忆',
    count: count(input.candidateClaims),
    severity: 'normal'
  }, {
    target: 'candidate_events',
    label: '候选事件',
    detail: '确认参与者、时间和事件内容',
    count: count(input.candidateEvents),
    severity: 'normal'
  }]
  return {
    items,
    total: items.reduce((sum, item) => sum + item.count, 0)
  }
}
