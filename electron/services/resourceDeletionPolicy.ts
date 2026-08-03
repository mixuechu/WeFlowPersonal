import crypto from 'crypto'

export type ResourceDeletionAction = 'delete' | 'purge'

export interface ResourceDeletionPreviewIdentity {
  action: ResourceDeletionAction
  resourceId: string
  identitySha256: string
}

export const buildResourceDeletionPreviewToken = (
  preview: ResourceDeletionPreviewIdentity
): string => crypto.createHash('sha256').update(JSON.stringify({
  action: preview.action,
  resourceId: String(preview.resourceId || '').trim(),
  identitySha256: String(preview.identitySha256 || '')
})).digest('hex')

export const resourceDeletionConfirmation = (
  action: ResourceDeletionAction
): string => action === 'purge' ? '永久删除资源' : '移入回收站'

export const assertResourceDeletionConfirmation = (
  currentPreview: ResourceDeletionPreviewIdentity,
  input: { previewToken?: string; confirmation?: string }
): void => {
  if (!String(input.previewToken || '') ||
      input.previewToken !== buildResourceDeletionPreviewToken(currentPreview)) {
    throw new Error('资源在预览后发生了变化，请重新核对处理范围')
  }
  const expected = resourceDeletionConfirmation(currentPreview.action)
  if (String(input.confirmation || '') !== expected) {
    throw new Error(`请输入“${expected}”确认`)
  }
}
