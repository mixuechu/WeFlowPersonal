import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  decodeEncryptedDurableJson,
  isEncryptedDurableJson,
  readEncryptedDurableJson,
  writeEncryptedDurableJson
} from '../electron/services/encryptedDurableJsonState.ts'

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-encrypted-state-'))
  try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('encrypted durable JSON hides plaintext and preserves an authenticated backup', () => withDirectory(directory => {
  const path = join(directory, 'state.json')
  const key = Buffer.alloc(32, 7)
  writeEncryptedDurableJson(path, { task: '给客户发送秘密方案', generation: 1 }, key)
  writeEncryptedDurableJson(path, { task: '第二版秘密方案', generation: 2 }, key)
  const primary = readFileSync(path, 'utf8')
  const backup = readFileSync(`${path}.bak`, 'utf8')
  assert.equal(primary.includes('第二版秘密方案'), false)
  assert.equal(backup.includes('给客户发送秘密方案'), false)
  assert.equal(isEncryptedDurableJson(primary), true)
  assert.equal(decodeEncryptedDurableJson<any>(primary, key).value.generation, 2)
  assert.equal(decodeEncryptedDurableJson<any>(backup, key).value.generation, 1)
}))

test('plaintext state migrates without copying plaintext into the backup', () => withDirectory(directory => {
  const path = join(directory, 'state.json')
  const key = Buffer.alloc(32, 9)
  writeFileSync(path, JSON.stringify({ task: '旧版明文任务', generation: 1 }))
  const loaded = readEncryptedDurableJson<any>(path, {}, key)
  assert.equal(loaded.encrypted, false)
  writeEncryptedDurableJson(path, loaded.value, key)
  assert.equal(readFileSync(path, 'utf8').includes('旧版明文任务'), false)
  assert.equal(readFileSync(`${path}.bak`, 'utf8').includes('旧版明文任务'), false)
  assert.equal(isEncryptedDurableJson(readFileSync(`${path}.bak`)), true)
}))

test('wrong keys and tampering never produce a fallback state over existing data', () => withDirectory(directory => {
  const path = join(directory, 'state.json')
  const key = Buffer.alloc(32, 3)
  writeEncryptedDurableJson(path, { generation: 1 }, key)
  const wrongKey = readEncryptedDurableJson(path, { generation: 0 }, Buffer.alloc(32, 4))
  assert.equal(wrongKey.recovery.source, 'empty')
  assert.match(wrongKey.recovery.primaryError, /认证失败/)
  const envelope = JSON.parse(readFileSync(path, 'utf8'))
  const ciphertext = String(envelope.ciphertext)
  envelope.ciphertext = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
  writeFileSync(path, JSON.stringify(envelope))
  const tampered = readEncryptedDurableJson(path, { generation: 0 }, key)
  assert.equal(tampered.recovery.source, 'empty')
  assert.equal(existsSync(path), true)
}))

test('corrupted primary recovers and repairs from an encrypted last-known-good copy', () => withDirectory(directory => {
  const path = join(directory, 'state.json')
  const key = Buffer.alloc(32, 5)
  writeEncryptedDurableJson(path, { generation: 1 }, key)
  writeEncryptedDurableJson(path, { generation: 2 }, key)
  writeFileSync(path, '{"broken":')
  const recovered = readEncryptedDurableJson<any>(path, { generation: 0 }, key)
  assert.equal(recovered.value.generation, 1)
  assert.equal(recovered.recovery.source, 'backup')
  assert.equal(recovered.recovery.repairedPrimary, true)
  assert.equal(isEncryptedDurableJson(readFileSync(path)), true)
}))
