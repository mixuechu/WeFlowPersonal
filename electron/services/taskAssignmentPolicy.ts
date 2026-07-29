export const TASK_ASSIGNMENT_POLICY_VERSION = 'task-assignment-v2'

export type TaskAssignmentDecision = {
  keep: boolean
  classification: 'mine' | 'uncertain' | 'others'
  taskKind: 'action' | 'delegated' | 'waiting'
  rationale: string
}

export function classifyTaskAssignment(input: {
  evidenceMessages: any[]
  modelClassification?: string
  modelTaskKind?: string
}): TaskAssignmentDecision {
  const evidenceText = input.evidenceMessages.map(message => String(message.content || '')).join('\n')
  const onlySentByUser = input.evidenceMessages.length > 0 &&
    input.evidenceMessages.every(message => message.direction === '我发送')
  const isRequest = /请|麻烦|帮我|帮忙|查一下|看一下|确认一下|问一下|发一下|给我|快/.test(evidenceText)
  const isSelfCommitment = /我(?:来|会|负责|去|处理|跟进|完成|安排|准备|需要|要)/.test(evidenceText)
  const isGroupBroadcast = input.evidenceMessages.some(message => message.isGroup) &&
    /@所有人|@全体成员|各位|大家|群公告/.test(evidenceText)
  let classification: TaskAssignmentDecision['classification'] =
    input.modelClassification === 'mine' || input.modelClassification === 'others'
      ? input.modelClassification
      : 'uncertain'
  let taskKind: TaskAssignmentDecision['taskKind'] =
    ['action', 'delegated', 'waiting'].includes(String(input.modelTaskKind))
      ? input.modelTaskKind as TaskAssignmentDecision['taskKind']
      : 'action'

  if (isGroupBroadcast && classification === 'mine' && !isSelfCommitment) {
    return {
      keep: true,
      classification: 'uncertain',
      taskKind: 'action',
      rationale: '群公告或面向所有人的请求没有明确指派给用户，进入归属确认'
    }
  }
  if (onlySentByUser && isRequest && !isSelfCommitment) {
    return {
      keep: true,
      classification: 'mine',
      taskKind: 'delegated',
      rationale: '用户发出请求，执行者是收件人；作为已委派事项由用户跟踪'
    }
  }
  if (onlySentByUser && isSelfCommitment) {
    return {
      keep: true,
      classification: 'mine',
      taskKind: 'action',
      rationale: '用户在自己发送的消息中明确承诺执行'
    }
  }
  if (classification === 'others') {
    return {
      keep: false,
      classification,
      taskKind,
      rationale: '任务明确属于其他人，且不是用户主动委派的跟踪事项'
    }
  }
  return {
    keep: true,
    classification,
    taskKind,
    rationale: classification === 'mine' ? '模型识别到明确指派或用户承诺' : '归属证据不足，进入人工确认'
  }
}

export const TASK_ASSIGNMENT_GOLDEN_SAMPLES = [{
  id: 'self-request-to-other',
  evidenceMessages: [{ direction: '我发送', content: '查一下几点更新' }],
  modelClassification: 'mine',
  expected: { keep: true, classification: 'mine', taskKind: 'delegated' }
}, {
  id: 'self-explicit-commitment',
  evidenceMessages: [{ direction: '我发送', content: '我来确认一下几点更新' }],
  modelClassification: 'mine',
  expected: { keep: true, classification: 'mine', taskKind: 'action' }
}, {
  id: 'incoming-direct-assignment',
  evidenceMessages: [{ direction: '对方发送', content: '李卓，麻烦你明天把方案发我' }],
  modelClassification: 'mine',
  expected: { keep: true, classification: 'mine', taskKind: 'action' }
}, {
  id: 'group-broadcast',
  evidenceMessages: [{ direction: '对方发送', isGroup: true, content: '@所有人 大家明天都看一下文档' }],
  modelClassification: 'mine',
  expected: { keep: true, classification: 'uncertain', taskKind: 'action' }
}, {
  id: 'assigned-to-someone-else',
  evidenceMessages: [{ direction: '对方发送', content: '让小王整理一下报价' }],
  modelClassification: 'others',
  expected: { keep: false, classification: 'others', taskKind: 'action' }
}, {
  id: 'ambiguous-discussion',
  evidenceMessages: [{ direction: '对方发送', isGroup: true, content: '这个方案后面可能还要再看看' }],
  modelClassification: 'uncertain',
  expected: { keep: true, classification: 'uncertain', taskKind: 'action' }
}] as const

export function evaluateTaskAssignmentPolicy(): {
  version: string
  samples: number
  exactAccuracy: number
  minePrecision: number
  mineRecall: number
  failures: string[]
} {
  let exact = 0
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  const failures: string[] = []
  for (const sample of TASK_ASSIGNMENT_GOLDEN_SAMPLES) {
    const actual = classifyTaskAssignment(sample)
    const expectedMine = sample.expected.keep && sample.expected.classification === 'mine'
    const actualMine = actual.keep && actual.classification === 'mine'
    if (actualMine && expectedMine) truePositive += 1
    if (actualMine && !expectedMine) falsePositive += 1
    if (!actualMine && expectedMine) falseNegative += 1
    if (actual.keep === sample.expected.keep &&
        actual.classification === sample.expected.classification &&
        actual.taskKind === sample.expected.taskKind) exact += 1
    else failures.push(sample.id)
  }
  return {
    version: TASK_ASSIGNMENT_POLICY_VERSION,
    samples: TASK_ASSIGNMENT_GOLDEN_SAMPLES.length,
    exactAccuracy: exact / TASK_ASSIGNMENT_GOLDEN_SAMPLES.length,
    minePrecision: truePositive / Math.max(1, truePositive + falsePositive),
    mineRecall: truePositive / Math.max(1, truePositive + falseNegative),
    failures
  }
}
