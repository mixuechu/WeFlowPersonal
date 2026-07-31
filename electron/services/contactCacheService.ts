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

let electronApp: any = null
try { electronApp = require('electron').app } catch {}

export interface ContactCacheEntry {
  displayName?: string
  avatarUrl?: string
  updatedAt: number
}

export class ContactCacheService {
  private readonly cacheFilePath: string
  private cache: Record<string, ContactCacheEntry> = {}
  private persistTimer: NodeJS.Timeout | null = null
  private persistInFlight = false
  private persistDirty = false
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private encryptionKey: Buffer | string

  constructor(cacheBasePath?: string, encryptionKey: Buffer | string = '') {
    this.encryptionKey = encryptionKey
    const basePath = cacheBasePath && cacheBasePath.trim().length > 0
      ? cacheBasePath
      : ConfigService.getInstance().getCacheBasePath()
    this.cacheFilePath = join(basePath, 'contacts.json')
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
      const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(
        this.cacheFilePath,
        this.encryptionKey
      )
      const parsed = loaded.value
      this.privacy = loaded.privacy
      if (parsed && typeof parsed === 'object') {
        // 清除无效的头像数据（hex 格式而非正确的 base64）
        for (const key of Object.keys(parsed)) {
          const entry = parsed[key]
          if (entry?.avatarUrl && entry.avatarUrl.includes('base64,ffd8')) {
            // 这是错误的 hex 格式，清除它
            entry.avatarUrl = undefined
          }
        }
        this.cache = parsed
      }
    } catch (error) {
      console.error('ContactCacheService: 载入缓存失败', error)
      this.cache = {}
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  get(username: string): ContactCacheEntry | undefined {
    return this.cache[username]
  }

  getAllEntries(): Record<string, ContactCacheEntry> {
    return { ...this.cache }
  }

  getPrivacyStatus(): unknown {
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.cacheFilePath),
      entries: Object.keys(this.cache).length
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
    if (Object.keys(pending).length > 0 && this.privacy.writable) this.persist()
  }

  setEntries(entries: Record<string, ContactCacheEntry>): void {
    if (Object.keys(entries).length === 0) return
    let changed = false
    for (const [username, entry] of Object.entries(entries)) {
      const existing = this.cache[username]
      if (!existing || entry.updatedAt >= existing.updatedAt) {
        this.cache[username] = entry
        changed = true
      }
    }
    if (changed) {
      this.persist()
    }
  }

  /** 防抖异步落盘：启动阶段批量补全联系人时避免连续同步写盘阻塞主线程 */
  private persist() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, 1000)
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
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.cache, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
    } catch (error) {
      console.error('ContactCacheService: 保存缓存失败', error)
    } finally {
      this.persistInFlight = false
      if (this.persistDirty) {
        this.persistDirty = false
        void this.persistNow()
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
        ...writeEncryptedSensitiveCache(this.cacheFilePath, this.cache, this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
    } catch (error) {
      console.error('ContactCacheService: 保存缓存失败', error)
    }
  }

  clear(): void {
    this.cache = {}
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      rmSync(this.cacheFilePath, { force: true })
    } catch (error) {
      console.error('ContactCacheService: 清理缓存失败', error)
    }
  }
}
