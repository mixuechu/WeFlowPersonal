export type SensitivePersistenceKind = 'derived_cache' | 'model_result' | 'operational_record'

export function sensitivePersistenceImpact(kind: SensitivePersistenceKind): string {
  if (kind === 'model_result') {
    return '模型生成结果仍保留在本次运行内存中，退出前会再次补写；若设备被强制断电，可能需要重新生成。SQLCipher 权威个人记忆未受影响。'
  }
  if (kind === 'operational_record') {
    return '用户已经导出的文件不受影响，仅内部导出历史尚未落盘。'
  }
  return '这是可重建派生缓存，不代表 SQLCipher 权威个人记忆丢失。'
}
