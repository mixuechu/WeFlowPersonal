import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { ConfigService } from './config.ts'
import {
  modelTraceContainsSensitivePayload,
  sanitizePersistedModelTrace
} from '../../shared/modelTracePrivacy.ts'
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

export type GroupSummaryTriggerType = 'auto' | 'manual'

export interface GroupSummaryTopic {
  title: string
  participants: string[]
  keyPoints: string[]
  conclusion: string
}

export interface GroupSummaryLog {
  endpoint: string
  model: string
  temperature: number
  triggerType: GroupSummaryTriggerType
  periodStart: number
  periodEnd: number
  messageCount: number
  readableMessageCount: number
  systemPrompt: string
  userPrompt: string
  rawOutput: string
  finalSummary: string
  durationMs: number
  createdAt: number
  responseFormatJson?: boolean
  responseFormatFallback?: boolean
  responseFormatFallbackReason?: string
  parsedTopics?: GroupSummaryTopic[]
  privacyVersion?: string
  sensitivePayloadRetained?: boolean
}

export interface GroupSummaryRecord {
  id: string
  accountScope: string
  createdAt: number
  sessionId: string
  displayName: string
  avatarUrl?: string
  triggerType: GroupSummaryTriggerType
  periodStart: number
  periodEnd: number
  messageCount: number
  readableMessageCount: number
  topics: GroupSummaryTopic[]
  summaryText: string
  rawOutput: string
  log: GroupSummaryLog
}

export interface GroupSummaryRecordSummary {
  id: string
  createdAt: number
  sessionId: string
  displayName: string
  avatarUrl?: string
  triggerType: GroupSummaryTriggerType
  periodStart: number
  periodEnd: number
  messageCount: number
  readableMessageCount: number
  topics: GroupSummaryTopic[]
  summaryText: string
}

export interface GroupSummaryRecordFilters {
  sessionId?: string
  startTime?: number
  endTime?: number
  limit?: number
  offset?: number
}

export interface GroupSummaryRecordListResult {
  success: boolean
  records: GroupSummaryRecordSummary[]
  total: number
  error?: string
}

interface GroupSummaryIndexRecord extends GroupSummaryRecordSummary {
  accountScope: string
  logFile?: string
}

interface LegacyGroupSummaryRecord extends GroupSummaryIndexRecord {
  rawOutput?: string
  log?: GroupSummaryLog
}

class GroupSummaryRecordService {
  private readonly maxRecordsPerScope = 2000
  private filePath: string | null = null
  private logDir: string | null = null
  private loaded = false
  private records: GroupSummaryIndexRecord[] = []
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()
  private persistenceRetry = emptyCachePersistenceRetry()
  private persistTimer: NodeJS.Timeout | null = null
  private pendingLogs = new Map<string, GroupSummaryLog>()

  constructor() {
    electronApp?.once?.('will-quit', () => this.flushPendingPersistence())
  }

  private encryptionKey(): string {
    return ConfigService.getInstance().getOrCreateLocalCacheEncryptionKey()
  }

  private resolveUserDataPath(): string {
    const workerUserDataPath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    const userDataPath = workerUserDataPath || electronApp?.getPath?.('userData') || process.cwd()
    fs.mkdirSync(userDataPath, { recursive: true })
    return userDataPath
  }

  private resolveFilePath(): string {
    if (this.filePath) return this.filePath
    this.filePath = path.join(this.resolveUserDataPath(), 'weflow-group-summary-records.json')
    return this.filePath
  }

  private resolveLogDir(): string {
    if (this.logDir) return this.logDir
    this.logDir = path.join(this.resolveUserDataPath(), 'weflow-group-summary-logs')
    fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 })
    return this.logDir
  }

  private normalizeTimestampSeconds(value: unknown): number {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    let normalized = Math.floor(numeric)
    while (normalized > 10000000000) {
      normalized = Math.floor(normalized / 1000)
    }
    return normalized
  }

  private safeLogFileName(id: string): string {
    const normalized = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
    return `${normalized || randomUUID()}.json`
  }

  private writeLogFile(recordId: string, log: GroupSummaryLog, rawOutput: string): string | undefined {
    const fileName = this.safeLogFileName(recordId)
    const sanitized = sanitizePersistedModelTrace({ ...log, rawOutput }) as GroupSummaryLog
    try {
      const logPath = path.join(this.resolveLogDir(), fileName)
      writeEncryptedSensitiveCache(
        logPath,
        { version: 3, rawOutput: '', log: sanitized },
        this.encryptionKey()
      )
      this.pendingLogs.delete(fileName)
      return fileName
    } catch (error) {
      this.pendingLogs.set(fileName, sanitized)
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
      this.persist(cachePersistenceRetryDelayMs(this.persistenceRetry))
      return fileName
    }
  }

  private readLogFile(fileName?: string): { rawOutput: string; log: GroupSummaryLog } | null {
    if (!fileName) return null
    try {
      const logPath = path.join(this.resolveLogDir(), this.safeLogFileName(fileName.replace(/\.json$/i, '')))
      if (!fs.existsSync(logPath)) return null
      const parsed = loadEncryptedSensitiveCache<any>(logPath, this.encryptionKey()).value
      const log = parsed?.log
      if (!log || typeof log !== 'object') return null
      const sanitized = sanitizePersistedModelTrace(log as GroupSummaryLog)
      if (Number(parsed?.version || 0) < 3 || modelTraceContainsSensitivePayload(log)) {
        writeEncryptedSensitiveCache(
          logPath,
          { version: 3, rawOutput: '', log: sanitized },
          this.encryptionKey()
        )
      }
      return {
        rawOutput: '',
        log: sanitized as GroupSummaryLog
      }
    } catch {
      return null
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const filePath = this.resolveFilePath()
    try {
      if (!fs.existsSync(filePath)) {
        this.sanitizeStoredLogFiles()
        this.removeLegacyPlaintextBackups()
        this.removeOrphanLogFiles()
        return
      }
      const loaded = loadEncryptedSensitiveCache<any>(filePath, this.encryptionKey())
      const parsed = loaded.value
      this.privacy = loaded.privacy
      const records = Array.isArray(parsed) ? parsed : parsed?.records
      if (!Array.isArray(records)) return

      const legacyRecords = records.filter((item) => item && typeof item === 'object') as LegacyGroupSummaryRecord[]
      const needsMigration = legacyRecords.some((record) => Boolean(record.log || record.rawOutput))

      this.records = legacyRecords.map((record) => {
        const id = String(record.id || randomUUID())
        const logFile = record.log
          ? this.writeLogFile(id, record.log, String(record.rawOutput || record.log.rawOutput || ''))
          : record.logFile
        return {
          id,
          accountScope: String(record.accountScope || 'default'),
          createdAt: Number(record.createdAt || Date.now()),
          sessionId: String(record.sessionId || ''),
          displayName: String(record.displayName || record.sessionId || ''),
          avatarUrl: record.avatarUrl,
          triggerType: record.triggerType === 'auto' ? 'auto' : 'manual',
          periodStart: this.normalizeTimestampSeconds(record.periodStart),
          periodEnd: this.normalizeTimestampSeconds(record.periodEnd),
          messageCount: Math.max(0, Math.floor(Number(record.messageCount || 0))),
          readableMessageCount: Math.max(0, Math.floor(Number(record.readableMessageCount || 0))),
          topics: Array.isArray(record.topics) ? record.topics : [],
          summaryText: String(record.summaryText || ''),
          logFile
        }
      }).filter((record) => record.sessionId && record.periodStart > 0 && record.periodEnd > record.periodStart)

      if (needsMigration) {
        this.persist()
      }
      this.sanitizeStoredLogFiles()
      this.removeLegacyPlaintextBackups()
      this.removeOrphanLogFiles()
    } catch (error) {
      this.records = []
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  private removeLegacyPlaintextBackups(): void {
    try {
      const userDataPath = this.resolveUserDataPath()
      for (const name of fs.readdirSync(userDataPath)) {
        if (/^weflow-group-summary-records\.json\.legacy-\d+\.bak$/.test(name)) {
          fs.unlinkSync(path.join(userDataPath, name))
        }
      }
    } catch {
      // Privacy migration is best effort; the primary record remains readable.
    }
  }

  private sanitizeStoredLogFiles(): void {
    try {
      const directory = this.resolveLogDir()
      for (const name of fs.readdirSync(directory)) {
        if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue
        const logPath = path.join(directory, name)
        try {
          const parsed = loadEncryptedSensitiveCache<any>(logPath, this.encryptionKey()).value
          const log = parsed?.log
          if (!log || typeof log !== 'object') continue
          const sanitized = sanitizePersistedModelTrace(log)
          writeEncryptedSensitiveCache(
            logPath,
            { version: 3, rawOutput: '', log: sanitized },
            this.encryptionKey()
          )
        } catch {}
      }
      fs.chmodSync(directory, 0o700)
    } catch {
      // Summary listing should survive an unreadable diagnostics directory.
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

  private writePendingLogs(): void {
    for (const [fileName, log] of this.pendingLogs) {
      writeEncryptedSensitiveCache(
        path.join(this.resolveLogDir(), fileName),
        { version: 3, rawOutput: '', log },
        this.encryptionKey()
      )
      this.pendingLogs.delete(fileName)
    }
  }

  private persistNow(): void {
    try {
      if (!this.privacy.writable) return
      this.writePendingLogs()
      const filePath = this.resolveFilePath()
      this.privacy = {
        ...writeEncryptedSensitiveCache(
          filePath,
          { version: 3, records: this.records },
          this.encryptionKey()
        ),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
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
      this.writePendingLogs()
      this.privacy = {
        ...writeEncryptedSensitiveCache(
          this.resolveFilePath(),
          { version: 3, records: this.records },
          this.encryptionKey()
        ),
        migratedPlaintext: this.privacy.migratedPlaintext
      }
      this.persistenceRetry = emptyCachePersistenceRetry()
    } catch (error) {
      this.persistenceRetry = planCachePersistenceRetry(this.persistenceRetry, error)
    }
  }

  private getCurrentAccountScope(): string {
    const config = ConfigService.getInstance()
    const myWxid = String(config.getMyWxidCleaned() || '').trim()
    if (myWxid) return `wxid:${myWxid}`

    const dbPath = String(config.get('dbPath') || '').trim()
    if (dbPath) {
      const hash = createHash('sha1').update(dbPath).digest('hex').slice(0, 16)
      return `db:${hash}`
    }
    return 'default'
  }

  private toSummary(record: GroupSummaryIndexRecord): GroupSummaryRecordSummary {
    return {
      id: record.id,
      createdAt: record.createdAt,
      sessionId: record.sessionId,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl,
      triggerType: record.triggerType,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      messageCount: record.messageCount,
      readableMessageCount: record.readableMessageCount,
      topics: Array.isArray(record.topics) ? record.topics : [],
      summaryText: record.summaryText || ''
    }
  }

  private getScopedRecords(): GroupSummaryIndexRecord[] {
    this.ensureLoaded()
    const scope = this.getCurrentAccountScope()
    return this.records.filter((record) => record.accountScope === scope)
  }

  addRecord(input: {
    sessionId: string
    displayName: string
    avatarUrl?: string
    triggerType: GroupSummaryTriggerType
    periodStart: number
    periodEnd: number
    messageCount: number
    readableMessageCount: number
    topics: GroupSummaryTopic[]
    summaryText: string
    rawOutput: string
    log: GroupSummaryLog
  }): GroupSummaryRecordSummary {
    this.ensureLoaded()
    const scope = this.getCurrentAccountScope()
    const id = randomUUID()
    const logFile = this.writeLogFile(id, input.log, input.rawOutput)
    const record: GroupSummaryIndexRecord = {
      id,
      accountScope: scope,
      createdAt: Date.now(),
      sessionId: input.sessionId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      triggerType: input.triggerType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      messageCount: input.messageCount,
      readableMessageCount: input.readableMessageCount,
      topics: input.topics,
      summaryText: input.summaryText,
      logFile
    }

    this.records.push(record)
    const scopedRecords = this.records
      .filter((item) => item.accountScope === scope)
      .sort((a, b) => b.createdAt - a.createdAt)
    const keepIds = new Set(scopedRecords.slice(0, this.maxRecordsPerScope).map((item) => item.id))
    this.records = this.records.filter((item) => item.accountScope !== scope || keepIds.has(item.id))
    this.removeOrphanLogFiles()
    this.persist()
    return this.toSummary(record)
  }

  hasAutoRecord(sessionId: string, periodStart: number, periodEnd: number): boolean {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return false
    return this.getScopedRecords().some((record) =>
      record.triggerType === 'auto' &&
      record.sessionId === normalizedSessionId &&
      Number(record.periodStart || 0) === periodStart &&
      Number(record.periodEnd || 0) === periodEnd
    )
  }

  listRecords(filters: GroupSummaryRecordFilters = {}): GroupSummaryRecordListResult {
    try {
      const sessionId = String(filters.sessionId || '').trim()
      const startTime = this.normalizeTimestampSeconds(filters.startTime)
      const endTime = this.normalizeTimestampSeconds(filters.endTime)
      const offset = Math.max(0, Math.floor(Number(filters.offset || 0)))
      const limit = Math.min(200, Math.max(1, Math.floor(Number(filters.limit || 100))))

      const filtered = this.getScopedRecords()
        .filter((record) => {
          if (sessionId && record.sessionId !== sessionId) return false
          const periodStart = Number(record.periodStart || 0)
          const periodEnd = Number(record.periodEnd || 0)
          if (startTime > 0 && periodEnd < startTime) return false
          if (endTime > 0 && periodStart > endTime) return false
          return true
        })
        .sort((a, b) => Number(b.periodStart || b.createdAt) - Number(a.periodStart || a.createdAt))

      return {
        success: true,
        records: filtered.slice(offset, offset + limit).map((record) => this.toSummary(record)),
        total: filtered.length
      }
    } catch (error) {
      return { success: false, records: [], total: 0, error: (error as Error).message || String(error) }
    }
  }

  getRecord(id: string): { success: boolean; record?: GroupSummaryRecord; error?: string } {
    this.ensureLoaded()
    const normalizedId = String(id || '').trim()
    if (!normalizedId) return { success: false, error: '记录 ID 为空' }
    const scope = this.getCurrentAccountScope()
    const record = this.records.find((item) => item.id === normalizedId && item.accountScope === scope)
    if (!record) return { success: false, error: '未找到该群聊总结记录' }

    const logData = this.readLogFile(record.logFile)
    if (!logData) return { success: false, error: '未找到该群聊总结日志' }

    return {
      success: true,
      record: {
        ...this.toSummary(record),
        accountScope: record.accountScope,
        rawOutput: logData.rawOutput,
        log: logData.log
      }
    }
  }

  clearRuntimeCache(): void {
    this.flushPendingPersistence()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.pendingLogs.clear()
    this.persistenceRetry = emptyCachePersistenceRetry()
    this.loaded = false
    this.records = []
    this.filePath = null
    this.logDir = null
  }

  migratePrivacy(): void {
    this.ensureLoaded()
  }

  getPrivacyStatus(): unknown {
    this.ensureLoaded()
    const logFiles = (() => {
      try {
        return fs.readdirSync(this.resolveLogDir())
          .filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      } catch { return [] }
    })()
    const logAudits = logFiles.map(name =>
      inspectSensitiveCacheFile(path.join(this.resolveLogDir(), name)))
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.resolveFilePath()),
      entries: this.records.length,
      logFiles: logFiles.length,
      logsEncrypted: logAudits.every(item => item.encrypted && item.mode === '600'),
      pendingLogFiles: this.pendingLogs.size,
      persistenceRetry: { ...this.persistenceRetry },
      content: 'group_summary_index_and_sanitized_model_logs'
    }
  }

  private removeOrphanLogFiles(): void {
    try {
      const referenced = new Set(this.records.map(record => record.logFile).filter(Boolean))
      for (const name of this.pendingLogs.keys()) {
        if (!referenced.has(name)) this.pendingLogs.delete(name)
      }
      for (const name of fs.readdirSync(this.resolveLogDir())) {
        if (/^[a-zA-Z0-9_-]+\.json$/.test(name) && !referenced.has(name)) {
          fs.unlinkSync(path.join(this.resolveLogDir(), name))
        }
      }
    } catch {}
  }
}

export const groupSummaryRecordService = new GroupSummaryRecordService()
