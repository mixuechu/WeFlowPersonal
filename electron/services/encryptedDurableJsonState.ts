import crypto from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { DurableJsonRecovery } from './durableJsonState'

const FORMAT = 'weflow-encrypted-json'
const VERSION = 1

type EncryptedEnvelope = {
  format: typeof FORMAT
  version: typeof VERSION
  algorithm: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

function normalizeKey(key: Buffer | string): Buffer {
  const value = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(String(key || ''), 'hex')
  if (value.length !== 32) throw new Error('AI 状态加密密钥无效')
  return value
}

export function isEncryptedDurableJson(content: Buffer | string): boolean {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : content)
    return parsed?.format === FORMAT && Number(parsed?.version) === VERSION
  } catch {
    return false
  }
}

export function encodeEncryptedDurableJson(value: unknown, key: Buffer | string): string {
  const normalizedKey = normalizeKey(key)
  try {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', normalizedKey, iv)
    cipher.setAAD(Buffer.from(`${FORMAT}:${VERSION}`, 'utf8'))
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope: EncryptedEnvelope = {
      format: FORMAT,
      version: VERSION,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    plaintext.fill(0)
    return `${JSON.stringify(envelope)}\n`
  } finally {
    normalizedKey.fill(0)
  }
}

export function decodeEncryptedDurableJson<T>(
  content: Buffer | string,
  key: Buffer | string,
  allowPlaintext = true
): { value: T; encrypted: boolean } {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content
  const envelope = JSON.parse(text)
  if (envelope?.format !== FORMAT) {
    if (!allowPlaintext) throw new Error('状态文件不是加密格式')
    return { value: envelope as T, encrypted: false }
  }
  if (Number(envelope.version) !== VERSION || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('不支持的 AI 状态加密格式')
  }
  const normalizedKey = normalizeKey(key)
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      normalizedKey,
      Buffer.from(String(envelope.iv || ''), 'base64')
    )
    decipher.setAAD(Buffer.from(`${FORMAT}:${VERSION}`, 'utf8'))
    decipher.setAuthTag(Buffer.from(String(envelope.tag || ''), 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(String(envelope.ciphertext || ''), 'base64')),
      decipher.final()
    ])
    try {
      return { value: JSON.parse(plaintext.toString('utf8')) as T, encrypted: true }
    } finally {
      plaintext.fill(0)
    }
  } catch {
    throw new Error('AI 状态文件认证失败：密钥不匹配或文件已损坏')
  } finally {
    normalizedKey.fill(0)
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function writeSyncedFile(path: string, content: string): void {
  const descriptor = openSync(path, 'w', 0o600)
  try {
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try { chmodSync(path, 0o600) } catch {}
}

export function writeEncryptedDurableJson(
  path: string,
  value: unknown,
  key: Buffer | string
): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  const backup = `${path}.bak`
  const backupTemporary = `${backup}.tmp`
  try {
    writeSyncedFile(temporary, encodeEncryptedDurableJson(value, key))
    if (existsSync(path)) {
      try {
        const current = decodeEncryptedDurableJson<unknown>(readFileSync(path), key, true).value
        writeSyncedFile(backupTemporary, encodeEncryptedDurableJson(current, key))
        renameSync(backupTemporary, backup)
      } catch {
        try { unlinkSync(backupTemporary) } catch {}
      }
    }
    renameSync(temporary, path)
    syncDirectory(directory)
  } catch (error) {
    try { unlinkSync(temporary) } catch {}
    try { unlinkSync(backupTemporary) } catch {}
    throw error
  }
}

export function readEncryptedDurableJson<T>(
  path: string,
  fallback: T,
  key: Buffer | string
): {
  value: T
  encrypted: boolean
  recovery: DurableJsonRecovery
} {
  let primaryError = ''
  let backupError = ''
  try {
    const decoded = decodeEncryptedDurableJson<T>(readFileSync(path), key, true)
    return {
      ...decoded,
      recovery: {
        source: 'primary',
        recovered: false,
        repairedPrimary: false,
        primaryError,
        backupError
      }
    }
  } catch (error) {
    primaryError = existsSync(path) ? String(error) : 'missing'
  }
  const backup = `${path}.bak`
  try {
    const decoded = decodeEncryptedDurableJson<T>(readFileSync(backup), key, true)
    let repairedPrimary = false
    try {
      writeEncryptedDurableJson(path, decoded.value, key)
      repairedPrimary = true
    } catch {}
    return {
      value: decoded.value,
      encrypted: decoded.encrypted,
      recovery: {
        source: 'backup',
        recovered: true,
        repairedPrimary,
        primaryError,
        backupError
      }
    }
  } catch (error) {
    backupError = existsSync(backup) ? String(error) : 'missing'
  }
  return {
    value: fallback,
    encrypted: false,
    recovery: {
      source: 'empty',
      recovered: false,
      repairedPrimary: false,
      primaryError,
      backupError
    }
  }
}
