import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const config = readFileSync(new URL('../electron/services/config.ts', import.meta.url), 'utf8')

test('normal sensitive configuration uses a local AES-256-GCM envelope instead of Safe Storage', () => {
  assert.match(config, /const LOCAL_PREFIX = 'local:v1:'/)
  assert.match(config, /createCipheriv\('aes-256-gcm', this\.localSecretKey, nonce\)/)
  assert.match(config, /createDecipheriv\('aes-256-gcm', this\.localSecretKey/)
  assert.match(config, /writeFileSync\(keyPath, crypto\.randomBytes\(32\), \{ flag: 'wx', mode: 0o600 \}\)/)
  assert.match(config, /chmodSync\(keyPath, 0o600\)/)
})

test('Safe Storage remains read-only compatibility for legacy safe-prefixed values', () => {
  assert.match(config, /仅用于旧版 safe: 值的一次性迁移/)
  assert.match(config, /this\.migrateLegacySafeStorageValues\(\)/)
  assert.match(config, /旧值解密失败时原样保留/)
  const encryptBody = config.slice(config.indexOf('private safeEncrypt'), config.indexOf('private safeDecrypt'))
  assert.doesNotMatch(encryptBody, /safeStorage\.encryptString/)
})

test('legacy migration covers Hello secrets and every nested WeChat account secret', () => {
  assert.match(config, /ENCRYPTED_NUMBER_KEYS, 'authHelloSecret'/)
  assert.match(config, /\['decryptKey', 'imageAesKey', 'imageXorKey'\]/)
  assert.match(config, /if \(changed\) \(this\.store as any\)\.store = next/)
})
