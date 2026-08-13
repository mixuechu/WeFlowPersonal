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

const CACHE_VERSION = 1
const MAX_GROUP_ENTRIES_PER_SCOPE = 3000
const MAX_SCOPE_ENTRIES = 12

export interface GroupMyMessageCountCacheEntry {
  updatedAt: number
  messageCount: number
}

interface GroupMyMessageCountScopeMap {
  [chatroomId: string]: GroupMyMessageCountCacheEntry
}

interface GroupMyMessageCountCacheStore {
  version: number
  scopes: Record<string, GroupMyMessageCountScopeMap>
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

function normalizeEntry(raw: unknown): GroupMyMessageCountCacheEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const updatedAt = toNonNegativeInt(source.updatedAt)
  const messageCount = toNonNegativeInt(source.messageCount)
  if (updatedAt === undefined || messageCount === undefined) return null
  return {
    updatedAt,
    messageCount
  }
}

export class GroupMyMessageCountCacheService {
  private readonly cacheFilePath: string
  private persistTimer: NodeJS.Timeout | null = null
  private persistInFlight = false
  private persistDirty = false
  private persistenceRetry = emptyCachePersistenceRetry()
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private encryptionKey: Buffer | string
  private store: GroupMyMessageCountCacheStore = {
    version: CACHE_VERSION,
    scopes: {}
  }

  constructor(cacheBasePath?: string, encryptionKey: Buffer | string = '') {
    this.encryptionKey = encryptionKey
    const basePath = cacheBasePath && cacheBasePath.trim().length > 0
      ? cacheBasePath
      : ConfigService.getInstance().getCacheBasePath()
    this.cacheFilePath = join(basePath, 'group-my-message-counts.json')
    this.ensureCacheDir()
    this.load()
    electronApp?.once?.('will-quit', () => this.flushSync())
  }

  private ensureCacheDir(): void {
    const dir = dirname(this.cacheFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private load(): void {
    try {
      const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(
        this.cacheFilePath,
        this.encryptionKey
      )
      const parsed = loaded.value
      this.privacy = loaded.privacy
      if (!parsed || typeof parsed !== 'object') {
        this.store = { version: CACHE_VERSION, scopes: {} }
        return
      }

      const payload = parsed as Record<string, unknown>
      const scopesRaw = payload.scopes
      if (!scopesRaw || typeof scopesRaw !== 'object') {
        this.store = { version: CACHE_VERSION, scopes: {} }
        return
      }

      const scopes: Record<string, GroupMyMessageCountScopeMap> = {}
      for (const [scopeKey, scopeValue] of Object.entries(scopesRaw as Record<string, unknown>)) {
        if (!scopeValue || typeof scopeValue !== 'object') continue
        const normalizedScope: GroupMyMessageCountScopeMap = {}
        for (const [chatroomId, entryRaw] of Object.entries(scopeValue as Record<string, unknown>)) {
          const entry = normalizeEntry(entryRaw)
          if (!entry) continue
          normalizedScope[chatroomId] = entry
        }
        if (Object.keys(normalizedScope).length > 0) {
          scopes[scopeKey] = normalizedScope
        }
      }

      this.store = {
        version: CACHE_VERSION,
        scopes
      }
    } catch (error) {
      console.error('GroupMyMessageCountCacheService: 载入缓存失败', error)
      this.store = { version: CACHE_VERSION, scopes: {} }
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  get(scopeKey: string, chatroomId: string): GroupMyMessageCountCacheEntry | undefined {
    if (!scopeKey || !chatroomId) return undefined
    const scope = this.store.scopes[scopeKey]
    if (!scope) return undefined
    const entry = normalizeEntry(scope[chatroomId])
    if (!entry) {
      delete scope[chatroomId]
      if (Object.keys(scope).length === 0) {
        delete this.store.scopes[scopeKey]
      }
      this.persist()
      return undefined
    }
    return entry
  }

  set(scopeKey: string, chatroomId: string, entry: GroupMyMessageCountCacheEntry): void {
    if (!scopeKey || !chatroomId) return
    const normalized = normalizeEntry(entry)
    if (!normalized) return

    if (!this.store.scopes[scopeKey]) {
      this.store.scopes[scopeKey] = {}
    }

    const existing = this.store.scopes[scopeKey][chatroomId]
    if (existing && existing.updatedAt > normalized.updatedAt) {
      return
    }

    this.store.scopes[scopeKey][chatroomId] = normalized
    this.trimScope(scopeKey)
    this.trimScopes()
    this.persist()
  }

  delete(scopeKey: string, chatroomId: string): void {
    if (!scopeKey || !chatroomId) return
    const scope = this.store.scopes[scopeKey]
    if (!scope) return
    if (!(chatroomId in scope)) return
    delete scope[chatroomId]
    if (Object.keys(scope).length === 0) {
      delete this.store.scopes[scopeKey]
    }
    this.persist()
  }

  clearScope(scopeKey: string): void {
    if (!scopeKey) return
    if (!this.store.scopes[scopeKey]) return
    delete this.store.scopes[scopeKey]
    this.persist()
  }

  clearAll(): void {
    this.store = { version: CACHE_VERSION, scopes: {} }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      rmSync(this.cacheFilePath, { force: true })
    } catch (error) {
      console.error('GroupMyMessageCountCacheService: 清理缓存失败', error)
    }
  }

  getPrivacyStatus(): unknown {
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.cacheFilePath),
      entries: Object.values(this.store.scopes).reduce((total, scope) => total + Object.keys(scope).length, 0),
      persistenceRetry: { ...this.persistenceRetry }
    }
  }

  initializeEncryption(encryptionKey: Buffer | string): void {
    if (!encryptionKey || (this.encryptionKey && this.privacy.writable)) return
    const pending = this.store
    this.encryptionKey = encryptionKey
    this.store = { version: CACHE_VERSION, scopes: {} }
    this.privacy = emptySensitiveCachePrivacy()
    this.load()
    let pendingEntries = 0
    for (const [scopeKey, scope] of Object.entries(pending.scopes)) {
      this.store.scopes[scopeKey] = { ...(this.store.scopes[scopeKey] || {}), ...scope }
      pendingEntries += Object.keys(scope).length
    }
    if (pendingEntries > 0 && this.privacy.writable) this.persist()
  }

  private trimScope(scopeKey: string): void {
    const scope = this.store.scopes[scopeKey]
    if (!scope) return
    const entries = Object.entries(scope)
    if (entries.length <= MAX_GROUP_ENTRIES_PER_SCOPE) return
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    const trimmed: GroupMyMessageCountScopeMap = {}
    for (const [chatroomId, entry] of entries.slice(0, MAX_GROUP_ENTRIES_PER_SCOPE)) {
      trimmed[chatroomId] = entry
    }
    this.store.scopes[scopeKey] = trimmed
  }

  private trimScopes(): void {
    const scopeEntries = Object.entries(this.store.scopes)
    if (scopeEntries.length <= MAX_SCOPE_ENTRIES) return
    scopeEntries.sort((a, b) => {
      const aUpdatedAt = Math.max(...Object.values(a[1]).map((entry) => entry.updatedAt), 0)
      const bUpdatedAt = Math.max(...Object.values(b[1]).map((entry) => entry.updatedAt), 0)
      return bUpdatedAt - aUpdatedAt
    })

    const trimmedScopes: Record<string, GroupMyMessageCountScopeMap> = {}
    for (const [scopeKey, scopeMap] of scopeEntries.slice(0, MAX_SCOPE_ENTRIES)) {
      trimmedScopes[scopeKey] = scopeMap
    }
    this.store.scopes = trimmedScopes
  }

  /** 防抖异步落盘：批量刷新群统计时避免连续同步写盘阻塞主线程 */
  private persist(delayMs = 1000): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, Math.max(0, delayMs))
    this.persistTimer.unref?.()
  }

  private async persistNow(): Promise<void> {
    if (this.persistInFlight) {
      this.persistDirty = true
      return
    }
    this.persistInFlight = true
    try {
      if (!this.privacy.writable) return
      this.privacy = {
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.store, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      console.error('GroupMyMessageCountCacheService: 保存缓存失败', error)
      this.persistDirty = true
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
    } finally {
      this.persistInFlight = false
      if (this.persistDirty) {
        this.persistDirty = false
        this.persist(cachePersistenceRetryDelayMs(this.persistenceRetry))
      }
    }
  }

  /** 退出前把尚未落盘的改动同步写入 */
  private flushSync(): void {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = null
    try {
      if (!this.privacy.writable) return
      this.privacy = {
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.store, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
    } catch (error) {
      console.error('GroupMyMessageCountCacheService: 保存缓存失败', error)
    }
  }
}
