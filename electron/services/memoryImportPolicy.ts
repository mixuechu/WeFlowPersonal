import crypto from 'crypto'

export interface MemoryImportPreviewIdentity {
  bundleSha256: string
  databaseSha256: string
  stateSha256: string
  currentStateSha256: string
}

export const buildMemoryImportPreviewToken = (
  identity: MemoryImportPreviewIdentity
): string => crypto.createHash('sha256').update(JSON.stringify({
  bundleSha256: String(identity.bundleSha256 || ''),
  databaseSha256: String(identity.databaseSha256 || ''),
  stateSha256: String(identity.stateSha256 || ''),
  currentStateSha256: String(identity.currentStateSha256 || '')
})).digest('hex')

export const assertMemoryImportConfirmation = (
  currentIdentity: MemoryImportPreviewIdentity,
  input: { previewToken?: string; confirmation?: string }
): void => {
  if (!String(input.previewToken || '') ||
      input.previewToken !== buildMemoryImportPreviewToken(currentIdentity)) {
    throw new Error('迁移包或当前个人记忆在预览后发生了变化，请重新核对导入范围')
  }
  if (String(input.confirmation || '') !== '导入并替换') {
    throw new Error('请输入“导入并替换”确认覆盖当前个人记忆')
  }
}
