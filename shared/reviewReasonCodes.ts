export const REVIEW_REASON_CODES = [
  'unspecified',
  'incorrect_assignment',
  'wrong_subject',
  'wrong_object',
  'wrong_relation',
  'wrong_time',
  'duplicate',
  'identity_mismatch',
  'insufficient_evidence',
  'irrelevant',
  'other'
] as const

export type ReviewReasonCode = typeof REVIEW_REASON_CODES[number]
export type ReviewReasonDomain = 'task' | 'memory' | 'graph' | 'identity'

const DOMAIN_CODES: Record<ReviewReasonDomain, readonly ReviewReasonCode[]> = {
  task: ['incorrect_assignment', 'insufficient_evidence', 'irrelevant', 'duplicate', 'other'],
  memory: [
    'wrong_subject', 'wrong_object', 'wrong_time', 'duplicate',
    'insufficient_evidence', 'irrelevant', 'other'
  ],
  graph: [
    'wrong_subject', 'wrong_object', 'wrong_relation', 'identity_mismatch',
    'duplicate', 'insufficient_evidence', 'irrelevant', 'other'
  ],
  identity: ['identity_mismatch', 'insufficient_evidence', 'other']
}

export const REVIEW_REASON_LABELS: Record<ReviewReasonCode, string> = {
  unspecified: '未标注具体原因',
  incorrect_assignment: '不是分配给我的事',
  wrong_subject: '主体识别错误',
  wrong_object: '对象或值识别错误',
  wrong_relation: '关系类型或方向错误',
  wrong_time: '时间识别错误',
  duplicate: '重复内容',
  identity_mismatch: '人物身份对应错误',
  insufficient_evidence: '原文证据不足',
  irrelevant: '与我无关或不值得记忆',
  other: '其他原因'
}

export const reviewReasonOptions = (domain: ReviewReasonDomain) =>
  DOMAIN_CODES[domain].map(code => ({ code, label: REVIEW_REASON_LABELS[code] }))

export const normalizeReviewReasonCode = (
  domain: ReviewReasonDomain,
  value: unknown
): ReviewReasonCode => {
  const code = String(value || '') as ReviewReasonCode
  return DOMAIN_CODES[domain].includes(code) ? code : 'unspecified'
}
