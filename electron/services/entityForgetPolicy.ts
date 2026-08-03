import crypto from 'crypto'

export interface EntityForgetPreviewIdentity {
  entityId: string
  canonicalName: string
  names?: string[]
  claimIds?: string[]
  relationIds?: string[]
  eventIds?: string[]
  taskIds?: string[]
}

const normalizedList = (values: unknown): string[] => Array.isArray(values)
  ? [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
  : []

export const buildEntityForgetPreviewToken = (preview: EntityForgetPreviewIdentity): string =>
  crypto.createHash('sha256').update(JSON.stringify({
    entityId: String(preview.entityId || '').trim(),
    canonicalName: String(preview.canonicalName || '').trim(),
    names: normalizedList(preview.names),
    claimIds: normalizedList(preview.claimIds),
    relationIds: normalizedList(preview.relationIds),
    eventIds: normalizedList(preview.eventIds),
    taskIds: normalizedList(preview.taskIds)
  })).digest('hex')

export const assertEntityForgetConfirmation = (
  currentPreview: EntityForgetPreviewIdentity,
  input: { previewToken?: string; confirmation?: string }
): void => {
  const expectedToken = buildEntityForgetPreviewToken(currentPreview)
  if (!String(input.previewToken || '') || input.previewToken !== expectedToken) {
    throw new Error('人物资料在预览后发生了变化，请重新核对删除范围')
  }
  if (String(input.confirmation || '') !== String(currentPreview.canonicalName || '')) {
    throw new Error(`请输入人物名称“${currentPreview.canonicalName}”确认彻底遗忘`)
  }
}
