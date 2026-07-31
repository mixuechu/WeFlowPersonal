import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import {
  isEncryptedDurableJson,
  readEncryptedDurableJson,
  writeEncryptedDurableJson
} from './encryptedDurableJsonState.ts'

export const ENCRYPTED_SENSITIVE_CACHE_VERSION = 'encrypted-sensitive-cache-v1'

export type SensitiveCachePrivacy = {
  version: typeof ENCRYPTED_SENSITIVE_CACHE_VERSION
  encrypted: boolean
  migratedPlaintext: boolean
  recoverySource: 'primary' | 'backup' | 'empty'
  repairedPrimary: boolean
  writable: boolean
  error: string
}

export function emptySensitiveCachePrivacy(): SensitiveCachePrivacy {
  return {
    version: ENCRYPTED_SENSITIVE_CACHE_VERSION,
    encrypted: false,
    migratedPlaintext: false,
    recoverySource: 'empty',
    repairedPrimary: false,
    writable: true,
    error: ''
  }
}

export function loadEncryptedSensitiveCache<T extends Record<string, unknown>>(
  path: string,
  key: Buffer | string
): { value: T; privacy: SensitiveCachePrivacy } {
  const fallback = {} as T
  if (!path || !key) {
    return {
      value: fallback,
      privacy: { ...emptySensitiveCachePrivacy(), writable: false, error: '敏感缓存加密密钥不可用' }
    }
  }
  const loaded = readEncryptedDurableJson<T>(path, fallback, key)
  const missing = loaded.recovery.source === 'empty'
    && loaded.recovery.primaryError === 'missing'
    && loaded.recovery.backupError === 'missing'
  if (loaded.recovery.source === 'empty' && !missing) {
    return {
      value: fallback,
      privacy: {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: '敏感缓存认证失败；已保留原文件且停止写入'
      }
    }
  }
  let migratedPlaintext = false
  let encrypted = loaded.encrypted
  if (loaded.recovery.source !== 'empty' && !loaded.encrypted) {
    writeEncryptedDurableJson(path, loaded.value, key)
    migratedPlaintext = true
    encrypted = true
  }
  return {
    value: loaded.value,
    privacy: {
      version: ENCRYPTED_SENSITIVE_CACHE_VERSION,
      encrypted,
      migratedPlaintext,
      recoverySource: loaded.recovery.source,
      repairedPrimary: loaded.recovery.repairedPrimary,
      writable: true,
      error: ''
    }
  }
}

export function writeEncryptedSensitiveCache(
  path: string,
  value: Record<string, unknown>,
  key: Buffer | string
): SensitiveCachePrivacy {
  if (!path || !key) {
    return { ...emptySensitiveCachePrivacy(), writable: false, error: '敏感缓存加密密钥不可用' }
  }
  writeEncryptedDurableJson(path, value, key)
  return {
    version: ENCRYPTED_SENSITIVE_CACHE_VERSION,
    encrypted: true,
    migratedPlaintext: false,
    recoverySource: 'primary',
    repairedPrimary: false,
    writable: true,
    error: ''
  }
}

export function inspectSensitiveCacheFile(path: string): {
  exists: boolean
  encrypted: boolean
  mode: string | null
  bytes: number
} {
  if (!path || !existsSync(path)) return { exists: false, encrypted: false, mode: null, bytes: 0 }
  try {
    try { chmodSync(path, 0o600) } catch {}
    const stat = statSync(path)
    return {
      exists: true,
      encrypted: isEncryptedDurableJson(readFileSync(path)),
      mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      bytes: stat.size
    }
  } catch {
    return { exists: true, encrypted: false, mode: null, bytes: 0 }
  }
}
