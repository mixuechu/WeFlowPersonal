import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const config = readFileSync(new URL('../electron/services/config.ts', import.meta.url), 'utf8')

test('normal sensitive configuration uses a local AES-256-GCM envelope instead of Safe Storage', () => {
  assert.match(config, /const LOCAL_PREFIX = 'local:v1:'/)
  assert.match(config, /createCipheriv\('aes-256-gcm', this\.localSecretKey, nonce\)/)
  assert.match(config, /createDecipheriv\('aes-256-gcm', this\.localSecretKey/)
  assert.match(config, /writeFileSync\(keyPath, crypto\.randomBytes\(32\), \{ flag: 'wx', mode: 0o600 \}\)/)
  assert.match(config, /chmodSync\(path, 0o600\)/)
})

test('Safe Storage remains read-only compatibility for legacy safe-prefixed values', () => {
  assert.match(config, /仅用于旧版 safe: 值的一次性迁移/)
  assert.match(config, /migrateStartupConfigurationAtomically/)
  assert.match(config, /旧 Safe Storage 值无法解密/)
  const encryptBody = config.slice(config.indexOf('private safeEncrypt'), config.indexOf('private safeDecrypt'))
  assert.doesNotMatch(encryptBody, /safeStorage\.encryptString/)
})

test('legacy migration covers Hello secrets and every nested WeChat account secret', () => {
  assert.match(config, /ENCRYPTED_NUMBER_KEYS, 'authHelloSecret'/)
  assert.match(config, /\['decryptKey', 'imageAesKey', 'imageXorKey'\]/)
  assert.match(config, /private migrateStartupConfiguration\(\)/)
})

test('privacy diagnostics expose only bounded local-secret health and reject symlink roots', () => {
  assert.match(config, /getLocalSecretStorageStatus\(\)/)
  assert.match(config, /directorySymlink/)
  assert.match(config, /keyFileSymlink/)
  assert.match(config, /!directoryInfo\.isDirectory\(\) \|\| directoryInfo\.isSymbolicLink\(\)/)
  const statusBody = config.slice(
    config.indexOf('getLocalSecretStorageStatus()'),
    config.indexOf('getOrCreateLocalCacheEncryptionKey()')
  )
  const returnedProjection = statusBody.slice(statusBody.lastIndexOf('return {'))
  assert.doesNotMatch(returnedProjection, /keyPath\s*[,}]/)
  assert.doesNotMatch(returnedProjection, /localSecretKey\s*[,}]/)
})

test('application lock verification recognizes the new local encrypted boolean', () => {
  const verifyBody = config.slice(
    config.indexOf('verifyAuthEnabled(): boolean'),
    config.indexOf('// === 工具方法 ===')
  )
  assert.match(verifyBody, /rawEnabled\.startsWith\(LOCAL_PREFIX\)/)
  assert.match(verifyBody, /this\.safeDecrypt\(rawEnabled\) === 'true'/)
})

test('new sensitive writes fail closed instead of falling back to plaintext', () => {
  const encryptBody = config.slice(config.indexOf('private safeEncrypt'), config.indexOf('private safeDecrypt'))
  assert.match(encryptBody, /本机主密钥不可用，敏感配置未写入/)
  assert.doesNotMatch(encryptBody, /if \(!this\.localSecretKey\) return plaintext/)
})
