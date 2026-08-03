import crypto from 'crypto'

export type StructuredMemoryDeletionReason = 'manual_delete' | 'not_important'

export interface StructuredMemoryDeletionPreviewIdentity {
  kind: 'claim' | 'event' | 'relation'
  id: string
  reason: StructuredMemoryDeletionReason
  identitySha256: string
}

export const structuredMemoryDeletionConfirmation = (
  reason: StructuredMemoryDeletionReason
): string => reason === 'not_important' ? '标记不重要' : '永久删除'

export const buildStructuredMemoryDeletionPreviewToken = (
  preview: StructuredMemoryDeletionPreviewIdentity
): string => crypto.createHash('sha256').update(JSON.stringify({
  kind: preview.kind,
  id: String(preview.id || '').trim(),
  reason: preview.reason,
  identitySha256: String(preview.identitySha256 || '')
})).digest('hex')

export const assertStructuredMemoryDeletionConfirmation = (
  currentPreview: StructuredMemoryDeletionPreviewIdentity,
  input: { previewToken?: string; confirmation?: string }
): void => {
  if (!String(input.previewToken || '') ||
      input.previewToken !== buildStructuredMemoryDeletionPreviewToken(currentPreview)) {
    throw new Error('记忆内容或关联范围在预览后发生了变化，请重新核对')
  }
  const expected = structuredMemoryDeletionConfirmation(currentPreview.reason)
  if (String(input.confirmation || '') !== expected) {
    throw new Error(`请输入“${expected}”确认`)
  }
}
