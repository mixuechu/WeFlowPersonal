import crypto from 'node:crypto'

export const MEMORY_BACKUP_RESTORE_CONFIRMATION = '恢复快照'
export const MEMORY_BACKUP_DELETE_CONFIRMATION = '移到废纸篓'

export type MemoryBackupRestoreIdentity = {
  backupPath: string
  backupDatabaseSha256: string
  backupStateSha256: string
  currentDatabaseSha256: string
  currentStateSha256: string
}

export function buildMemoryBackupRestorePreviewToken(
  identity: MemoryBackupRestoreIdentity
): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    action: 'restore_memory_backup',
    backupPath: String(identity.backupPath || ''),
    backupDatabaseSha256: String(identity.backupDatabaseSha256 || ''),
    backupStateSha256: String(identity.backupStateSha256 || ''),
    currentDatabaseSha256: String(identity.currentDatabaseSha256 || ''),
    currentStateSha256: String(identity.currentStateSha256 || '')
  })).digest('hex')
}

export function assertMemoryBackupRestoreConfirmation(
  identity: MemoryBackupRestoreIdentity,
  input: { previewToken?: string; confirmation?: string }
): void {
  if (!input?.previewToken ||
    input.previewToken !== buildMemoryBackupRestorePreviewToken(identity)) {
    throw new Error('快照或当前个人记忆在预览后发生了变化，请重新核对恢复范围')
  }
  if (String(input.confirmation || '') !== MEMORY_BACKUP_RESTORE_CONFIRMATION) {
    throw new Error(`请输入“${MEMORY_BACKUP_RESTORE_CONFIRMATION}”确认恢复`)
  }
}

export type MemoryBackupDeletionIdentity = {
  backupPath: string
  backupDatabaseSha256: string
  backupStateSha256: string
}

export function buildMemoryBackupDeletionPreviewToken(
  identity: MemoryBackupDeletionIdentity
): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    action: 'trash_memory_backup',
    backupPath: String(identity.backupPath || ''),
    backupDatabaseSha256: String(identity.backupDatabaseSha256 || ''),
    backupStateSha256: String(identity.backupStateSha256 || '')
  })).digest('hex')
}

export function assertMemoryBackupDeletionConfirmation(
  identity: MemoryBackupDeletionIdentity,
  input: { previewToken?: string; confirmation?: string }
): void {
  if (!input?.previewToken ||
    input.previewToken !== buildMemoryBackupDeletionPreviewToken(identity)) {
    throw new Error('快照文件在预览后发生了变化，请重新核对删除范围')
  }
  if (String(input.confirmation || '') !== MEMORY_BACKUP_DELETE_CONFIRMATION) {
    throw new Error(`请输入“${MEMORY_BACKUP_DELETE_CONFIRMATION}”确认移到废纸篓`)
  }
}
