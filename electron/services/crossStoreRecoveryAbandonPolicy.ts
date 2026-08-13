import { createHash } from 'node:crypto'

export type CrossStoreRecoveryAbandonIdentity = {
  kind: 'task' | 'source'
  commitId: string
  preparedPayloadSha256: string
  currentStateSha256: string
  recoveryAttempts: number
}

const tokenFor = (identity: CrossStoreRecoveryAbandonIdentity): string =>
  createHash('sha256').update(JSON.stringify(identity)).digest('hex')

export function buildCrossStoreRecoveryAbandonToken(
  identity: CrossStoreRecoveryAbandonIdentity
): string {
  return tokenFor(identity)
}

export function assertCrossStoreRecoveryAbandon(
  identity: CrossStoreRecoveryAbandonIdentity,
  input: { previewToken?: unknown; confirmation?: unknown }
): void {
  if (String(input?.confirmation || '') !== '保留当前状态') {
    throw new Error('请输入“保留当前状态”确认放弃旧中断写入')
  }
  const provided = String(input?.previewToken || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided) || provided !== tokenFor(identity)) {
    throw new Error('恢复现场或当前状态在预览后已经变化，请重新预览')
  }
}
