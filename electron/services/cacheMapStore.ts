import { join } from 'path'
import { rmSync } from 'fs'
import {
  emptySensitiveCachePrivacy,
  inspectSensitiveCacheFile,
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache,
  type SensitiveCachePrivacy
} from './encryptedSensitiveCache.ts'

// 条件导入 electron（Worker 环境中不可用）
let app: any = null
try {
  app = require('electron').app
} catch {
  // Worker 环境
}

/**
 * 大体积 UI 缓存（*CacheMap 键）的独立存储。
 *
 * 这些键此前存放在 electron-store 主配置中，而 conf 库每次 get/set
 * 都会同步读写整个配置文件（曾膨胀到 3.2MB），主线程单次阻塞可达
 * 数十毫秒且高频发生。此处改为：内存 Map 直接服务读写 + 防抖异步
 * 落盘 + 退出时同步 flush，读写路径完全不再碰磁盘。
 */
export class CacheMapStore {
  private readonly filePath: string
  private data = new Map<string, unknown>()
  private persistTimer: NodeJS.Timeout | null = null
  private persistInFlight = false
  private persistDirty = false
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private encryptionKey: Buffer | string

  constructor(userDataPath: string, encryptionKey: Buffer | string) {
    this.encryptionKey = encryptionKey
    this.filePath = join(userDataPath, 'WeFlow-cache-maps.json')
    this.load()
    app?.once?.('will-quit', () => this.flushSync())
  }

  private load(): void {
    try {
      const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(this.filePath, this.encryptionKey)
      const parsed = loaded.value
      this.privacy = loaded.privacy
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          this.data.set(key, value)
        }
      }
    } catch (error) {
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
      console.error('CacheMapStore: 载入缓存失败', error)
    }
  }

  get(key: string): unknown {
    return this.data.get(key)
  }

  set(key: string, value: unknown): void {
    if (value === undefined) {
      this.data.delete(key)
    } else {
      this.data.set(key, value)
    }
    this.persist()
  }

  entries(): Record<string, unknown> {
    return Object.fromEntries(this.data)
  }

  getPrivacyStatus(): unknown {
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.filePath),
      entries: this.data.size
    }
  }

  isWritable(): boolean {
    return this.privacy.writable
  }

  initializeEncryption(encryptionKey: Buffer | string): void {
    if (!encryptionKey || (this.encryptionKey && this.privacy.writable)) return
    const pending = Object.fromEntries(this.data)
    this.encryptionKey = encryptionKey
    this.data.clear()
    this.privacy = emptySensitiveCachePrivacy()
    this.load()
    for (const [key, value] of Object.entries(pending)) this.data.set(key, value)
    if (Object.keys(pending).length > 0 && this.privacy.writable) this.persist()
  }

  clear(): void {
    this.data.clear()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      rmSync(this.filePath, { force: true })
    } catch (error) {
      console.error('CacheMapStore: 清理缓存失败', error)
    }
  }

  private persist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, 500)
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
        ...writeEncryptedSensitiveCache(this.filePath, Object.fromEntries(this.data), this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
    } catch (error) {
      console.error('CacheMapStore: 保存缓存失败', error)
    } finally {
      this.persistInFlight = false
      if (this.persistDirty) {
        this.persistDirty = false
        void this.persistNow()
      }
    }
  }

  /** 有待写改动时同步写入（应用退出前或迁移完成后调用） */
  flushSync(): void {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = null
    try {
      if (!this.privacy.writable) return
      this.privacy = {
        ...writeEncryptedSensitiveCache(this.filePath, Object.fromEntries(this.data), this.encryptionKey),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
    } catch (error) {
      console.error('CacheMapStore: 保存缓存失败', error)
    }
  }
}
