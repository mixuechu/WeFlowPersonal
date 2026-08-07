export type MemoryBackupDirectoryItem = {
  path: string
  createdAt?: string
  hasState?: boolean
  restoreStatus?: 'restorable' | 'invalid' | 'incomplete'
  restoreFailure?: string | null
  [key: string]: unknown
}

export function buildMemoryBackupDirectory(backups: unknown): MemoryBackupDirectoryItem[] {
  if (!Array.isArray(backups)) return []
  return backups.filter((backup): backup is MemoryBackupDirectoryItem =>
    Boolean(backup && typeof backup === 'object' && String((backup as any).path || '').trim()))
}

export function describeMemoryBackupRestore(
  backup: MemoryBackupDirectoryItem
): {
  enabled: boolean
  title: string
  suffix: string
} {
  if (!backup.hasState || backup.restoreStatus === 'incomplete') {
    return {
      enabled: false,
      title: '该历史快照缺少 AI 状态文件，只保留现场，不能执行完整恢复',
      suffix: '（仅数据库）'
    }
  }
  if (backup.restoreStatus === 'restorable') {
    return {
      enabled: true,
      title: '已验证数据库与加密状态均可读取；恢复数据库、图谱、任务和增量游标',
      suffix: '（已验证可恢复）'
    }
  }
  const reason = backup.restoreFailure === 'database_invalid'
    ? '数据库损坏或无法读取'
    : backup.restoreFailure === 'database_unencrypted'
      ? '数据库未加密'
      : backup.restoreFailure === 'state_unencrypted'
        ? 'AI 状态未加密'
        : backup.restoreFailure === 'state_invalid'
          ? 'AI 状态损坏或密钥不匹配'
          : '尚未完成恢复验证'
  return {
    enabled: false,
    title: `${reason}；已保留原始现场，但不能作为完整快照恢复`,
    suffix: `（${reason}）`
  }
}
