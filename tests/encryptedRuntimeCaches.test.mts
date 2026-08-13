import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheMapStore } from '../electron/services/cacheMapStore.ts'
import { ContactCacheService } from '../electron/services/contactCacheService.ts'
import { GroupMyMessageCountCacheService } from '../electron/services/groupMyMessageCountCacheService.ts'
import { SessionStatsCacheService } from '../electron/services/sessionStatsCacheService.ts'
import { MessageCacheService } from '../electron/services/messageCacheService.ts'
import { isEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'

function assertEncrypted(path: string, forbidden: string[]): void {
  const content = readFileSync(path)
  assert.equal(isEncryptedDurableJson(content), true)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  for (const value of forbidden) assert.equal(content.toString('utf8').includes(value), false)
}

test('runtime identity and usage caches migrate plaintext and remain readable after encryption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-runtime-cache-'))
  const cacheDirectory = join(directory, 'cache')
  const key = randomBytes(32)
  mkdirSync(cacheDirectory)
  try {
    writeFileSync(join(cacheDirectory, 'contacts.json'), JSON.stringify({
      'wxid-private-person': { displayName: '私密联系人', updatedAt: 123 }
    }))
    writeFileSync(join(cacheDirectory, 'session-stats.json'), JSON.stringify({
      version: 4,
      scopes: {
        'private-scope': {
          'private-session': {
            updatedAt: 456,
            includeRelations: false,
            stats: {
              totalMessages: 9,
              voiceMessages: 1,
              imageMessages: 1,
              videoMessages: 1,
              emojiMessages: 1,
              fileMessages: 1,
              transferMessages: 1,
              redPacketMessages: 1,
              callMessages: 1
            }
          }
        }
      }
    }))
    writeFileSync(join(cacheDirectory, 'group-my-message-counts.json'), JSON.stringify({
      version: 1,
      scopes: {
        'private-scope': {
          'private-chatroom': { updatedAt: 789, messageCount: 12 }
        }
      }
    }))

    const contacts = new ContactCacheService(cacheDirectory)
    const sessionStats = new SessionStatsCacheService(cacheDirectory)
    const groupCounts = new GroupMyMessageCountCacheService(cacheDirectory)

    assert.equal(contacts.get('wxid-private-person'), undefined)
    assert.equal(readFileSync(join(cacheDirectory, 'contacts.json'), 'utf8').includes('私密联系人'), true)
    contacts.setEntries({ 'wxid-early': { displayName: '启动早期联系人', updatedAt: 999 } })
    sessionStats.set('private-scope', 'early-session', {
      updatedAt: 999,
      includeRelations: false,
      stats: {
        totalMessages: 2,
        voiceMessages: 0,
        imageMessages: 0,
        videoMessages: 0,
        emojiMessages: 0,
        fileMessages: 0,
        transferMessages: 0,
        redPacketMessages: 0,
        callMessages: 0
      }
    })
    groupCounts.set('private-scope', 'early-chatroom', { updatedAt: 999, messageCount: 2 })
    contacts.initializeEncryption(key)
    sessionStats.initializeEncryption(key)
    groupCounts.initializeEncryption(key)
    ;(contacts as any).flushSync()
    ;(sessionStats as any).flushSync()
    ;(groupCounts as any).flushSync()

    assert.equal(contacts.get('wxid-private-person')?.displayName, '私密联系人')
    assert.equal(contacts.get('wxid-early')?.displayName, '启动早期联系人')
    assert.equal(sessionStats.get('private-scope', 'private-session')?.stats.totalMessages, 9)
    assert.equal(sessionStats.get('private-scope', 'early-session')?.stats.totalMessages, 2)
    assert.equal(groupCounts.get('private-scope', 'private-chatroom')?.messageCount, 12)
    assert.equal(groupCounts.get('private-scope', 'early-chatroom')?.messageCount, 2)
    assertEncrypted(join(cacheDirectory, 'contacts.json'), ['wxid-private-person', '私密联系人'])
    assertEncrypted(join(cacheDirectory, 'session-stats.json'), ['private-session', 'private-scope'])
    assertEncrypted(join(cacheDirectory, 'group-my-message-counts.json'), ['private-chatroom', 'private-scope'])
  } finally {
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('new runtime cache writes and UI cache maps never persist identifiers as plaintext', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-runtime-cache-'))
  const cacheDirectory = join(directory, 'cache')
  const key = randomBytes(32)
  try {
    const contacts = new ContactCacheService(cacheDirectory, key)
    contacts.setEntries({
      'wxid-new-private': { displayName: '新增联系人', updatedAt: Date.now() }
    })
    ;(contacts as any).flushSync()

    const sessionStats = new SessionStatsCacheService(cacheDirectory, key)
    sessionStats.set('scope-new-private', 'session-new-private', {
      updatedAt: Date.now(),
      includeRelations: false,
      stats: {
        totalMessages: 1,
        voiceMessages: 0,
        imageMessages: 0,
        videoMessages: 0,
        emojiMessages: 0,
        fileMessages: 0,
        transferMessages: 0,
        redPacketMessages: 0,
        callMessages: 0
      }
    })
    ;(sessionStats as any).flushSync()

    const groupCounts = new GroupMyMessageCountCacheService(cacheDirectory, key)
    groupCounts.set('scope-new-private', 'chatroom-new-private', {
      updatedAt: Date.now(),
      messageCount: 3
    })
    ;(groupCounts as any).flushSync()

    const maps = new CacheMapStore(directory, key)
    maps.set('analytics-private-CacheMap', { 'wxid-new-private': true })
    maps.flushSync()

    assertEncrypted(join(cacheDirectory, 'contacts.json'), ['wxid-new-private', '新增联系人'])
    assertEncrypted(join(cacheDirectory, 'session-stats.json'), ['session-new-private', 'scope-new-private'])
    assertEncrypted(join(cacheDirectory, 'group-my-message-counts.json'), ['chatroom-new-private', 'scope-new-private'])
    assertEncrypted(join(directory, 'WeFlow-cache-maps.json'), ['analytics-private-CacheMap', 'wxid-new-private'])
  } finally {
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('UI cache maps defer migration until the local encryption key becomes available', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-runtime-cache-'))
  const path = join(directory, 'WeFlow-cache-maps.json')
  const key = randomBytes(32)
  try {
    writeFileSync(path, JSON.stringify({
      analyticsExcludedCacheMap: { 'wxid-deferred-private': true }
    }))
    const maps = new CacheMapStore(directory, '')
    assert.equal(maps.get('analyticsExcludedCacheMap'), undefined)
    assert.equal(readFileSync(path, 'utf8').includes('wxid-deferred-private'), true)

    maps.initializeEncryption(key)
    assert.deepEqual(maps.get('analyticsExcludedCacheMap'), { 'wxid-deferred-private': true })
    assertEncrypted(path, ['analyticsExcludedCacheMap', 'wxid-deferred-private'])
  } finally {
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy plaintext session message cache migrates without losing bounded conversations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-message-cache-'))
  const key = randomBytes(32)
  const path = join(directory, 'session-messages.json')
  try {
    writeFileSync(path, JSON.stringify({
      'wxid-private-session': {
        version: 3,
        updatedAt: 123,
        messages: [{ localId: 1, parsedContent: '不能留在磁盘上的聊天正文' }]
      }
    }))
    const cache = new MessageCacheService(directory, key)
    assert.equal(cache.get('wxid-private-session')?.messages[0]?.parsedContent,
      '不能留在磁盘上的聊天正文')
    const privacy = cache.getPrivacyStatus() as any
    assert.equal(privacy.encrypted, true)
    assert.equal(privacy.migratedPlaintext, true)
    assert.equal(privacy.entries, 1)
    assert.equal(privacy.messages, 1)
    assertEncrypted(path, ['wxid-private-session', '不能留在磁盘上的聊天正文'])
    cache.clear()
  } finally {
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('session message cache is wired to local encryption, diagnostics, and bounded retry', () => {
  const chat = readFileSync(
    new URL('../electron/services/chatService.ts', import.meta.url),
    'utf8'
  )
  const cache = readFileSync(
    new URL('../electron/services/messageCacheService.ts', import.meta.url),
    'utf8'
  )
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(chat, /new MessageCacheService\([^\n]*localCacheKey\)/)
  assert.match(chat, /sessionMessages: this\.messageCacheService\.getPrivacyStatus\(\)/)
  assert.match(cache, /writeEncryptedSensitiveCache/)
  assert.match(cache, /planCachePersistenceRetry/)
  assert.doesNotMatch(cache, /fsPromises\.writeFile/)
  assert.match(page, /会话消息缓存/)
  assert.match(page, /sensitiveCaches\.sessionMessages\.encrypted/)
})
