import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectSensitiveCacheFile,
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache
} from '../electron/services/encryptedSensitiveCache.ts'

test('legacy plaintext sensitive caches migrate immediately to authenticated encryption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-sensitive-cache-'))
  const path = join(directory, 'cache.json')
  const key = randomBytes(32)
  try {
    writeFileSync(path, JSON.stringify({ message: '不应继续明文保存的聊天内容' }))
    const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(path, key)
    assert.equal(loaded.value.message, '不应继续明文保存的聊天内容')
    assert.equal(loaded.privacy.migratedPlaintext, true)
    assert.equal(loaded.privacy.encrypted, true)
    assert.equal(readFileSync(path, 'utf8').includes('聊天内容'), false)
    assert.equal(inspectSensitiveCacheFile(path).encrypted, true)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(existsSync(`${path}.bak`), true)
    assert.equal(readFileSync(`${path}.bak`, 'utf8').includes('聊天内容'), false)
  } finally {
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('tampered or wrong-key sensitive caches are preserved and become read-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-sensitive-cache-'))
  const path = join(directory, 'cache.json')
  const key = randomBytes(32)
  const wrongKey = randomBytes(32)
  try {
    writeEncryptedSensitiveCache(path, { transcript: '原始转写' }, key)
    const original = readFileSync(path)
    const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(path, wrongKey)
    assert.deepEqual(loaded.value, {})
    assert.equal(loaded.privacy.writable, false)
    assert.match(loaded.privacy.error, /保留原文件/)
    assert.deepEqual(readFileSync(path), original)
  } finally {
    key.fill(0)
    wrongKey.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})
