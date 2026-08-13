import fs from 'fs'
import path from 'path'
import { ConfigService } from './config.ts'
import {
  emptySensitiveCachePrivacy,
  inspectSensitiveCacheFile,
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache,
  type SensitiveCachePrivacy
} from './encryptedSensitiveCache.ts'
import {
  cachePersistenceRetryDelayMs,
  emptyCachePersistenceRetry,
  planCachePersistenceRetry
} from './cachePersistenceRetry.ts'

let electronApp: any = null
try { electronApp = require('electron').app } catch {}

export interface ExportRecord {
  exportTime: number
  format: string
  messageCount: number
  sourceLatestMessageTimestamp?: number
  outputPath?: string
}

type RecordStore = Record<string, ExportRecord[]>

class ExportRecordService {
  private filePath: string | null = null
  private loaded = false
  private store: RecordStore = {}
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private persistenceRetry = emptyCachePersistenceRetry()
  private persistTimer: NodeJS.Timeout | null = null

  constructor() {
    electronApp?.once?.('will-quit', () => this.flushPendingPersistence())
  }

  private encryptionKey(): string {
    return ConfigService.getInstance().getOrCreateLocalCacheEncryptionKey()
  }

  private resolveFilePath(): string {
    if (this.filePath) return this.filePath
    const workerUserDataPath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    const userDataPath = workerUserDataPath || electronApp?.getPath?.('userData') || process.cwd()
    fs.mkdirSync(userDataPath, { recursive: true })
    this.filePath = path.join(userDataPath, 'weflow-export-records.json')
    return this.filePath
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const filePath = this.resolveFilePath()
    try {
      const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(filePath, this.encryptionKey())
      this.privacy = loaded.privacy
      const parsed = loaded.value
      if (parsed && typeof parsed === 'object') {
        const candidate = parsed.version === 2 && parsed.records && typeof parsed.records === 'object'
          ? parsed.records
          : parsed
        this.store = candidate as RecordStore
      }
    } catch (error) {
      this.store = {}
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  private persist(delayMs = 0): void {
    if (this.persistTimer) return
    if (delayMs > 0) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        this.persistNow()
      }, delayMs)
      this.persistTimer.unref?.()
      return
    }
    this.persistNow()
  }

  private persistNow(): void {
    try {
      if (!this.privacy.writable) return
      const filePath = this.resolveFilePath()
      this.privacy = writeEncryptedSensitiveCache(
        filePath,
        { version: 2, records: this.store },
        this.encryptionKey()
      )
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
      this.persist(cachePersistenceRetryDelayMs(this.persistenceRetry))
    }
  }

  private flushPendingPersistence(): void {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = null
    try {
      if (!this.privacy.writable) return
      this.privacy = writeEncryptedSensitiveCache(
        this.resolveFilePath(),
        { version: 2, records: this.store },
        this.encryptionKey()
      )
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
    }
  }

  migratePrivacy(): void {
    this.ensureLoaded()
  }

  getPrivacyStatus(): SensitiveCachePrivacy & {
    exists: boolean
    mode: string | null
    bytes: number
    sessions: number
    records: number
  } {
    this.ensureLoaded()
    const inspected = inspectSensitiveCacheFile(this.resolveFilePath())
    return {
      ...this.privacy,
      ...inspected,
      sessions: Object.keys(this.store).length,
      records: Object.values(this.store).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0),
      persistenceRetry: { ...this.persistenceRetry }
    }
  }

  getLatestRecord(sessionId: string, format: string): ExportRecord | null {
    this.ensureLoaded()
    const records = this.store[sessionId]
    if (!records || records.length === 0) return null
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]
      if (record && record.format === format) return record
    }
    return null
  }

  saveRecord(
    sessionId: string,
    format: string,
    messageCount: number,
    extra?: {
      sourceLatestMessageTimestamp?: number
      outputPath?: string
    }
  ): void {
    this.ensureLoaded()
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return
    if (!this.store[normalizedSessionId]) {
      this.store[normalizedSessionId] = []
    }
    const list = this.store[normalizedSessionId]
    list.push({
      exportTime: Date.now(),
      format,
      messageCount,
      sourceLatestMessageTimestamp: extra?.sourceLatestMessageTimestamp,
      outputPath: extra?.outputPath
    })
    // keep the latest 30 records per session
    if (list.length > 30) {
      this.store[normalizedSessionId] = list.slice(-30)
    }
    this.persist()
  }
}

export const exportRecordService = new ExportRecordService()
