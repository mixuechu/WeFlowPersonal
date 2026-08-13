import {
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache,
  type SensitiveCachePrivacy
} from './encryptedSensitiveCache.ts'

export function loadInsightProfileCache<T extends Record<string, unknown>>(
  filePath: string,
  encryptionKey: Buffer | string
): { value: T; privacy: SensitiveCachePrivacy } {
  return loadEncryptedSensitiveCache<T>(filePath, encryptionKey)
}

export function writeInsightProfileCache(
  filePath: string,
  records: unknown[],
  encryptionKey: Buffer | string
): SensitiveCachePrivacy {
  return writeEncryptedSensitiveCache(filePath, { version: 2, records }, encryptionKey)
}
