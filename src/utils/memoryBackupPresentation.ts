export type MemoryBackupDirectoryItem = {
  path: string
  createdAt?: string
  hasState?: boolean
  [key: string]: unknown
}

export function buildMemoryBackupDirectory(backups: unknown): MemoryBackupDirectoryItem[] {
  if (!Array.isArray(backups)) return []
  return backups.filter((backup): backup is MemoryBackupDirectoryItem =>
    Boolean(backup && typeof backup === 'object' && String((backup as any).path || '').trim()))
}
