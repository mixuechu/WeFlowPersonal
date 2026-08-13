import { join, dirname } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { ConfigService } from './config.ts'
import {
  emptySensitiveCachePrivacy,
  inspectSensitiveCacheFile,
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache,
  type SensitiveCachePrivacy
} from './encryptedSensitiveCache.ts'
import { cachePersistenceRetryDelayMs, emptyCachePersistenceRetry, planCachePersistenceRetry } from './cachePersistenceRetry.ts'

let electronApp: any = null
try { electronApp = require('electron').app } catch {}

export interface SessionMessageCacheEntry {
  version?: number
  updatedAt: number
  messages: any[]
}

export class MessageCacheService {
  private static readonly CACHE_VERSION = 3
  private readonly cacheFilePath: string
  private cache: Record<string, SessionMessageCacheEntry> = {}
  // 每会话 80 条已覆盖首屏渲染（DB 拉取会随后补全），48→24 个会话、150→80 条
  // 可把该缓存的常驻内存压到原来的 1/4 左右
  private readonly sessionLimit = 80
  private readonly maxSessionEntries = 24
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private persistInFlight = false
  private persistQueued = false
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private persistenceRetry = emptyCachePersistenceRetry()
  private encryptionKey: Buffer | string

  constructor(cacheBasePath?: string, encryptionKey: Buffer | string = '') {
    this.encryptionKey = encryptionKey
    const basePath = cacheBasePath && cacheBasePath.trim().length > 0
      ? cacheBasePath
      : ConfigService.getInstance().getCacheBasePath()
    this.cacheFilePath = join(basePath, 'session-messages.json')
    this.ensureCacheDir()
    this.loadCache()
    electronApp?.once?.('will-quit', () => this.flushSync())
  }

  private ensureCacheDir() {
    const dir = dirname(this.cacheFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private loadCache() {
    try {
      const loaded = loadEncryptedSensitiveCache<Record<string, SessionMessageCacheEntry>>(
        this.cacheFilePath,
        this.encryptionKey
      )
      const parsed = loaded.value
      this.privacy = loaded.privacy
      if (parsed && typeof parsed === 'object') {
        this.cache = Object.fromEntries(
          Object.entries(parsed as Record<string, SessionMessageCacheEntry>)
            .filter(([, entry]) => entry?.version === MessageCacheService.CACHE_VERSION)
        )
        this.pruneSessionEntries()
      }
    } catch (error) {
      console.error('MessageCacheService: 载入缓存失败', error)
      this.cache = {}
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  private pruneSessionEntries(): void {
    const entries = Object.entries(this.cache || {})
    if (entries.length <= this.maxSessionEntries) return

    entries.sort((left, right) => {
      const leftAt = Number(left[1]?.updatedAt || 0)
      const rightAt = Number(right[1]?.updatedAt || 0)
      return rightAt - leftAt
    })

    this.cache = Object.fromEntries(entries.slice(0, this.maxSessionEntries))
  }

  get(sessionId: string): SessionMessageCacheEntry | undefined {
    return this.cache[sessionId]
  }

  set(sessionId: string, messages: any[]): void {
    if (!sessionId) return
    const trimmed = messages.length > this.sessionLimit
      ? messages.slice(-this.sessionLimit)
      : messages.slice()
    this.cache[sessionId] = {
      version: MessageCacheService.CACHE_VERSION,
      updatedAt: Date.now(),
      messages: trimmed
    }
    this.pruneSessionEntries()
    this.schedulePersist()
  }

  private schedulePersist(delayMs = 250): void {
    this.persistQueued = true
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist()
    }, Math.max(0, delayMs))
    this.persistTimer.unref?.()
  }

  private async persist() {
    if (this.persistInFlight) {
      this.schedulePersist()
      return
    }
    if (!this.persistQueued) return
    this.persistQueued = false
    this.persistInFlight = true
    try {
      if (!this.privacy.writable) return
      this.privacy = {
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.cache, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      console.error('MessageCacheService: 保存缓存失败', error)
      this.persistQueued = true
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
    } finally {
      this.persistInFlight = false
      if (this.persistQueued) {
        this.schedulePersist(cachePersistenceRetryDelayMs(this.persistenceRetry))
      }
    }
  }

  initializeEncryption(encryptionKey: Buffer | string): void {
    if (!encryptionKey || (this.encryptionKey && this.privacy.writable)) return
    const pending = this.cache
    this.encryptionKey = encryptionKey
    this.cache = {}
    this.privacy = emptySensitiveCachePrivacy()
    this.loadCache()
    this.cache = { ...this.cache, ...pending }
    this.pruneSessionEntries()
    if (Object.keys(this.cache).length > 0 && this.privacy.writable) this.schedulePersist(0)
  }

  getPrivacyStatus(): unknown {
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.cacheFilePath),
      entries: Object.keys(this.cache).length,
      messages: Object.values(this.cache).reduce((total, entry) =>
        total + (Array.isArray(entry.messages) ? entry.messages.length : 0), 0),
      persistenceRetry: { ...this.persistenceRetry }
    }
  }

  private flushSync(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    if (!this.persistQueued || !this.privacy.writable) return
    try {
      this.privacy = {
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.cache, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
      this.persistQueued = false
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
      console.error('MessageCacheService: 退出前保存缓存失败', error)
    }
  }

  clear(): void {
    this.cache = {}
    this.persistQueued = false
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      rmSync(this.cacheFilePath, { force: true })
    } catch (error) {
      console.error('MessageCacheService: 清理缓存失败', error)
    }
  }
}
