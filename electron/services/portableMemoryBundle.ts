import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from 'node:crypto'

const MAGIC = Buffer.from('WFPMEM2\0', 'ascii')
const HEADER_BYTES = 16 + 12 + 16
const SCRYPT_OPTIONS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  const normalized = String(passphrase || '').normalize('NFKC')
  if (normalized.length < 12) throw new Error('迁移口令至少需要 12 个字符')
  return scryptSync(normalized, salt, 32, SCRYPT_OPTIONS)
}

export function isPortableMemoryBundle(payload: Uint8Array): boolean {
  const value = Buffer.from(payload)
  return value.length >= MAGIC.length && value.subarray(0, MAGIC.length).equals(MAGIC)
}

export function encryptPortableMemoryBundle(plaintext: Uint8Array, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  key.fill(0)
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext])
}

export function decryptPortableMemoryBundle(payload: Uint8Array, passphrase: string): Buffer {
  const value = Buffer.from(payload)
  if (!isPortableMemoryBundle(value) || value.length <= MAGIC.length + HEADER_BYTES) {
    throw new Error('不支持的个人记忆迁移包格式')
  }
  const offset = MAGIC.length
  const salt = value.subarray(offset, offset + 16)
  const iv = value.subarray(offset + 16, offset + 28)
  const tag = value.subarray(offset + 28, offset + 44)
  const ciphertext = value.subarray(offset + 44)
  const key = deriveKey(passphrase, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(MAGIC)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('迁移口令不正确，或迁移包已经损坏')
  } finally {
    key.fill(0)
  }
}
