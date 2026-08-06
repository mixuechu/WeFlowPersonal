import type { ReviewReturnTarget } from './reviewReturnTarget'

export function reviewSourceKindLabel(kind: ReviewReturnTarget['kind']): string {
  return kind === 'project' ? '项目' : '实体档案'
}

export function compactReviewSourceId(sourceId: unknown): string {
  const id = String(sourceId || '').trim()
  return id.length <= 24 ? id : `${id.slice(0, 10)}…${id.slice(-10)}`
}

export function trustedEntityTypeLabel(type: unknown): string {
  return ({
    person: '人物',
    organization: '组织',
    group: '群聊',
    project: '项目',
    location: '地点',
    product: '产品'
  } as Record<string, string>)[String(type || '').trim()] || '实体'
}
