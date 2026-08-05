import { assessScheduledSyncResult } from './scheduledSyncPolicy.ts'
import { buildEncryptedAssistantState } from '../../shared/taskStateStorage.ts'

export const AUTOMATIC_MEMORY_BACKUP_POLICY_VERSION = 'automatic-memory-backup-v1'
export const AUTOMATIC_MEMORY_BACKUP_STATE_POLICY_VERSION =
  'automatic-memory-backup-state-v2'
export const AUTOMATIC_MEMORY_BACKUP_RETRY_MS = 60 * 60_000

export function buildAutomaticMemoryBackupSnapshotState(state: any): any {
  return buildEncryptedAssistantState(state)
}

export function automaticMemoryBackupDate(timestampMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestampMs))
}

export function shouldCreateAutomaticMemoryBackup(
  result: any,
  cursor: any,
  timestampMs = Date.now()
): { create: boolean; reason: 'due' | 'sync_incomplete' | 'already_created' | 'retry_backoff'; date: string } {
  const date = automaticMemoryBackupDate(timestampMs)
  if (!assessScheduledSyncResult(result).complete) {
    return { create: false, reason: 'sync_incomplete', date }
  }
  if (String(cursor?.lastAutomaticBackupDate || '') === date) {
    return { create: false, reason: 'already_created', date }
  }
  const lastAttemptAt = Date.parse(String(cursor?.lastAutomaticBackupAttemptAt || ''))
  if (
    String(cursor?.lastAutomaticBackupError || '').trim()
    && Number.isFinite(lastAttemptAt)
    && timestampMs - lastAttemptAt < AUTOMATIC_MEMORY_BACKUP_RETRY_MS
  ) {
    return { create: false, reason: 'retry_backoff', date }
  }
  return { create: true, reason: 'due', date }
}
