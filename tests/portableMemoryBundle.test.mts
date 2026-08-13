import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decryptPortableMemoryBundle,
  encryptPortableMemoryBundle,
  isPortableMemoryBundle
} from '../electron/services/portableMemoryBundle.ts'

test('portable memory bundle uses an authenticated passphrase envelope', () => {
  const plaintext = Buffer.from('portable-personal-memory-test')
  const passphrase = 'correct horse battery staple'
  const encrypted = encryptPortableMemoryBundle(plaintext, passphrase)

  assert.equal(isPortableMemoryBundle(encrypted), true)
  assert.notEqual(encrypted.includes(plaintext), true)
  assert.deepEqual(decryptPortableMemoryBundle(encrypted, passphrase), plaintext)
  assert.throws(
    () => decryptPortableMemoryBundle(encrypted, 'wrong passphrase value'),
    /口令不正确|已经损坏/
  )

  const tampered = Buffer.from(encrypted)
  tampered[tampered.length - 1] ^= 1
  assert.throws(
    () => decryptPortableMemoryBundle(tampered, passphrase),
    /口令不正确|已经损坏/
  )
  assert.throws(
    () => encryptPortableMemoryBundle(plaintext, 'too-short'),
    /至少需要 12 个字符/
  )
})
