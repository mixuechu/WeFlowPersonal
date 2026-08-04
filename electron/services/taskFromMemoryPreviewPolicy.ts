import { createHash } from 'node:crypto'

export type TaskFromMemoryPreviewIdentity = {
  assistantMessageId: string
  answerContentSha256: string
  groundingSha256: string
  evidenceSha256: string
  taskId: string
  currentTaskToken: string
}

const tokenFor = (identity: TaskFromMemoryPreviewIdentity): string =>
  createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')

export function buildTaskFromMemoryPreviewToken(
  identity: TaskFromMemoryPreviewIdentity
): string {
  return tokenFor(identity)
}

export function assertTaskFromMemoryPreview(
  identity: TaskFromMemoryPreviewIdentity,
  token: unknown
): void {
  const provided = String(token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided) || provided !== tokenFor(identity)) {
    throw new Error('这段回答、权威证据或已有待办在你预览后已经变化，请重新预览再生成')
  }
}
