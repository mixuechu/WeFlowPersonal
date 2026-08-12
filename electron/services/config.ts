import { join } from 'path'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import Store from 'electron-store'
import { expandHomePath } from '../utils/pathUtils.ts'
import { CacheMapStore } from './cacheMapStore.ts'

// 条件导入 electron（Worker 环境中不可用）
let app: any = null
let safeStorage: any = null
const isWorkerThread = process.env.WEFLOW_WORKER === '1'
if (!isWorkerThread) {
  try {
    const electron = require('electron')
    app = electron.app
    safeStorage = electron.safeStorage
  } catch {
    // Worker 环境中 electron 不可用
  }
}

// 加密前缀标记
const SAFE_PREFIX = 'safe:'  // 仅读：旧版 safeStorage 数据迁移
const LOCAL_PREFIX = 'local:v1:' // 本机密钥文件 + AES-256-GCM，不访问 macOS 钥匙串
const isSafeStorageAvailable = (): boolean => {
  try {
    return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
const LOCK_PREFIX = 'lock:'  // 密码派生密钥加密（锁定模式）

interface ConfigSchema {
  // 数据库相关
  dbPath: string
  decryptKey: string
  myWxid: string
  onboardingDone: boolean
  imageXorKey: number
  imageAesKey: string
  localCacheEncryptionKey: string
  wxidConfigs: Record<string, { decryptKey?: string; imageXorKey?: number; imageAesKey?: string; updatedAt?: number }>
  exportPath?: string;
  // 缓存相关
  cachePath: string
  lastOpenedDb: string
  lastSession: string

  // 界面相关
  theme: 'light' | 'dark' | 'system'
  themeId: string
  language: string
  logEnabled: boolean
  launchAtStartup?: boolean
  silentStartup?: boolean
  llmModelPath: string
  whisperModelName: string
  whisperModelDir: string
  whisperDownloadSource: string
  autoTranscribeVoice: boolean
  transcribeLanguages: string[]
  exportDefaultConcurrency: number
  exportDefaultPathStyle: 'auto' | 'posix' | 'windows'
  exportDefaultDisplayNamePreference: 'group-nickname' | 'remark' | 'nickname'
  analyticsExcludedUsernames: string[]

  // 安全相关
  authEnabled: boolean
  authPassword: string      // SHA-256 hash（本机密钥加密）
  authUseHello: boolean
  authHelloSecret: string   // 原始密码（本机密钥加密，Hello 解锁时使用）

  // 更新相关
  ignoredUpdateVersion: string
  updateChannel: 'auto' | 'stable' | 'preview' | 'dev'

  // 通知
  notificationEnabled: boolean
  aiInsightNotificationEnabled: boolean
  notificationPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
  notificationFilterMode: 'all' | 'whitelist' | 'blacklist'
  notificationFilterList: string[]
  messagePushEnabled: boolean
  messagePushFilterMode: 'all' | 'whitelist' | 'blacklist'
  messagePushFilterList: string[]
  httpApiEnabled: boolean
  httpApiPort: number
  httpApiHost: string
  httpApiToken: string
  windowCloseBehavior: 'ask' | 'tray' | 'quit'
  quoteLayout: 'quote-top' | 'quote-bottom'
  wordCloudExcludeWords: string[]
  exportWriteLayout: 'A' | 'B' | 'C'
  exportAutomationTaskMap: Record<string, unknown>

  // AI 见解
  aiModelApiBaseUrl: string
  aiModelApiKey: string
  aiModelApiModel: string
  aiModelApiMaxTokens: number
  aiAssistantEnabled: boolean
  aiAssistantApiBaseUrl: string
  aiAssistantApiKey: string
  aiAssistantDatabaseKey: string
  aiAssistantStateKey: string
  aiAssistantApiModel: string
  aiAssistantScheduleTime: string
  aiAssistantQuietStart: string
  aiAssistantQuietEnd: string
  aiAssistantInputCostPerMillion: number
  aiAssistantOutputCostPerMillion: number
  aiAssistantInitialLookbackDays: number
  aiAssistantOwnerName: string
  aiAssistantOwnerAliases: string
  aiAssistantOwnerBackground: string
  aiAssistantOwnerEntityId: string
  aiAssistantOcrImages: boolean
  aiAssistantAnalyzeImages: boolean
  aiAssistantIndexWebLinks: boolean
  aiAssistantResourceTrashRetentionDays: number
  aiAssistantSensitiveRedactionLevel: 'credentials' | 'standard' | 'strict'
  aiInsightEnabled: boolean
  aiInsightApiBaseUrl: string
  aiInsightApiKey: string
  aiInsightApiModel: string
  aiInsightSilenceDays: number
  aiInsightAllowContext: boolean
  aiInsightAllowMomentsContext: boolean
  aiInsightMomentsContextCount: number
  aiInsightMomentsBindings: Record<string, { enabled: boolean; updatedAt: number }>
  aiInsightAllowSocialContext: boolean
  aiInsightSocialContextCount: number
  aiInsightWeiboCookie: string
  aiInsightWeiboBindings: Record<string, { uid: string; screenName?: string; updatedAt: number }>
  aiInsightFilterMode: 'whitelist' | 'blacklist'
  aiInsightFilterList: string[]
  aiInsightWhitelistEnabled: boolean
  aiInsightWhitelist: string[]
  /** 活跃分析冷却时间（分钟），0 表示无冷却 */
  aiInsightCooldownMinutes: number
  /** 沉默联系人扫描间隔（小时） */
  aiInsightScanIntervalHours: number
  /** 发送上下文时的最大消息条数 */
  aiInsightContextCount: number
  /** 自定义 system prompt，空字符串表示使用内置默认值 */
  aiInsightSystemPrompt: string
  /** 是否启用 Telegram 推送 */
  aiInsightTelegramEnabled: boolean
  /** Telegram Bot Token */
  aiInsightTelegramToken: string
  /** Telegram 接收 Chat ID，逗号分隔，支持多个 */
  aiInsightTelegramChatIds: string

  // AI 足迹
  aiFootprintEnabled: boolean
  aiFootprintSystemPrompt: string
  aiGroupSummaryEnabled: boolean
  aiGroupSummaryIntervalHours: number
  aiGroupSummarySystemPrompt: string
  aiGroupSummaryFilterMode: 'whitelist' | 'blacklist'
  aiGroupSummaryFilterList: string[]
  aiMessageInsightEnabled: boolean
  aiMessageInsightContextCount: number
  aiMessageInsightSystemPrompt: string
  /** 是否将 AI 见解调试日志输出到桌面 */
  aiInsightDebugLogEnabled: boolean
  autoDownloadHighRes: boolean
  autoDownloadWhitelist: string[]
}

  // 需要本机密钥文件加密的字段（普通模式）
const ENCRYPTED_STRING_KEYS: Set<string> = new Set([
  'decryptKey',
  'imageAesKey',
  'localCacheEncryptionKey',
  'authPassword',
  'httpApiToken',
  'aiModelApiKey',
  'aiAssistantApiKey',
  'aiAssistantDatabaseKey',
  'aiAssistantStateKey',
  'aiInsightApiKey',
  'aiInsightWeiboCookie'
])
const ENCRYPTED_BOOL_KEYS: Set<string> = new Set(['authEnabled', 'authUseHello'])
const ENCRYPTED_NUMBER_KEYS: Set<string> = new Set(['imageXorKey'])

// 需要与密码绑定的敏感密钥字段（锁定模式时用 lock: 加密）
const LOCKABLE_STRING_KEYS: Set<string> = new Set(['decryptKey', 'imageAesKey'])
const LOCKABLE_NUMBER_KEYS: Set<string> = new Set(['imageXorKey'])

/**
 * 大体积 UI 缓存键（以 CacheMap 结尾），存入独立的 CacheMapStore。
 * conf 库对主配置文件的每次 get/set 都是全量同步读写，
 * 这些缓存曾把配置文件撑到 3.2MB，导致高频主线程阻塞。
 */
const isCacheMapKey = (key: string): boolean => key.endsWith('CacheMap')

export class ConfigService {
  private static instance: ConfigService
  private store!: Store<ConfigSchema>
  // Worker 环境不创建（CacheMap 键仅主进程访问，避免多进程并发写同一文件）
  private cacheMapStore: CacheMapStore | null = null

  // 锁定模式运行时状态
  private unlockedKeys: Map<string, any> = new Map()
  private unlockPassword: string | null = null

  // 账号目录缓存
  private accountDirCache: Map<string, string> = new Map()
  private localSecretKey: Buffer | null = null
  private localSecretRecovery = { backupAvailable: false, recoveredThisStart: false, error: '' }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService()
    }
    return ConfigService.instance
  }

  constructor() {
    if (ConfigService.instance) {
      return ConfigService.instance
    }
    ConfigService.instance = this
    const defaults: ConfigSchema = {
      dbPath: '',
      decryptKey: '',
      myWxid: '',
      onboardingDone: false,
      imageXorKey: 0,
      imageAesKey: '',
      localCacheEncryptionKey: '',
      wxidConfigs: {},
      cachePath: '',
      lastOpenedDb: '',
      lastSession: '',
      theme: 'system',
      themeId: 'cloud-dancer',
      language: 'zh-CN',
      logEnabled: false,
      silentStartup: false,
      llmModelPath: '',
      whisperModelName: 'base',
      whisperModelDir: '',
      whisperDownloadSource: 'tsinghua',
      autoTranscribeVoice: false,
      transcribeLanguages: ['zh'],
      exportDefaultConcurrency: 4,
      exportDefaultPathStyle: 'auto',
      exportDefaultDisplayNamePreference: 'remark',
      analyticsExcludedUsernames: [],
      authEnabled: false,
      authPassword: '',
      authUseHello: false,
      authHelloSecret: '',
      ignoredUpdateVersion: '',
      updateChannel: 'auto',
      notificationEnabled: true,
      aiInsightNotificationEnabled: true,
      notificationPosition: 'top-right',
      notificationFilterMode: 'all',
      notificationFilterList: [],
      httpApiToken: '',
      httpApiEnabled: false,
      httpApiPort: 5031,
      httpApiHost: '127.0.0.1',
      messagePushEnabled: false,
      messagePushFilterMode: 'all',
      messagePushFilterList: [],
      windowCloseBehavior: 'ask',
      quoteLayout: 'quote-top',
      wordCloudExcludeWords: [],
      exportWriteLayout: 'A',
      exportAutomationTaskMap: {},
      aiModelApiBaseUrl: '',
      aiModelApiKey: '',
      aiModelApiModel: 'gpt-4o-mini',
      aiModelApiMaxTokens: 1024,
      aiAssistantEnabled: true,
      aiAssistantApiBaseUrl: 'https://api.deepseek.com',
      aiAssistantApiKey: '',
      aiAssistantDatabaseKey: '',
      aiAssistantStateKey: '',
      aiAssistantApiModel: 'deepseek-v4-flash',
      aiAssistantScheduleTime: '20:00',
      aiAssistantQuietStart: '22:00',
      aiAssistantQuietEnd: '08:00',
      aiAssistantInputCostPerMillion: 0,
      aiAssistantOutputCostPerMillion: 0,
      aiAssistantInitialLookbackDays: 3,
      aiAssistantOwnerName: '',
      aiAssistantOwnerAliases: '',
      aiAssistantOwnerBackground: '',
      aiAssistantOwnerEntityId: '',
      aiAssistantOcrImages: false,
      aiAssistantAnalyzeImages: true,
      aiAssistantIndexWebLinks: false,
      aiAssistantResourceTrashRetentionDays: 0,
      aiAssistantSensitiveRedactionLevel: 'standard',
      aiInsightEnabled: false,
      aiInsightApiBaseUrl: '',
      aiInsightApiKey: '',
      aiInsightApiModel: 'gpt-4o-mini',
      aiInsightSilenceDays: 3,
      aiInsightAllowContext: false,
      aiInsightAllowMomentsContext: false,
      aiInsightMomentsContextCount: 5,
      aiInsightMomentsBindings: {},
      aiInsightAllowSocialContext: false,
      aiInsightFilterMode: 'whitelist',
      aiInsightFilterList: [],
      aiInsightWhitelistEnabled: false,
      aiInsightWhitelist: [],
      aiInsightCooldownMinutes: 120,
      aiInsightScanIntervalHours: 4,
      aiInsightContextCount: 40,
      aiInsightSocialContextCount: 3,
      aiInsightSystemPrompt: '',
      aiInsightTelegramEnabled: false,
      aiInsightTelegramToken: '',
      aiInsightTelegramChatIds: '',
      aiInsightWeiboCookie: '',
      aiInsightWeiboBindings: {},
      aiFootprintEnabled: false,
      aiFootprintSystemPrompt: '',
      aiGroupSummaryEnabled: false,
      aiGroupSummaryIntervalHours: 4,
      aiGroupSummarySystemPrompt: '',
      aiGroupSummaryFilterMode: 'whitelist',
      aiGroupSummaryFilterList: [],
      aiMessageInsightEnabled: false,
      aiMessageInsightContextCount: 50,
      aiMessageInsightSystemPrompt: '',
      aiInsightDebugLogEnabled: false,
      autoDownloadHighRes: false,
      autoDownloadWhitelist: []
    }

    const storeOptions: any = {
      name: 'WeFlow-config',
      defaults,
      projectName: String(process.env.WEFLOW_PROJECT_NAME || 'WeFlow').trim() || 'WeFlow'
    }
    const runningInWorker = process.env.WEFLOW_WORKER === '1'
    if (runningInWorker) {
      const cwd = String(process.env.WEFLOW_CONFIG_CWD || process.env.WEFLOW_USER_DATA_PATH || '').trim()
      if (cwd) {
        storeOptions.cwd = cwd
      }
    }

    try {
      this.store = new Store<ConfigSchema>(storeOptions)
    } catch (error) {
      const message = String((error as Error)?.message || error || '')
      if (message.includes('projectName')) {
        const fallbackOptions = {
          ...storeOptions,
          projectName: 'WeFlow',
          cwd: storeOptions.cwd || process.env.WEFLOW_CONFIG_CWD || process.env.WEFLOW_USER_DATA_PATH || process.cwd()
        }
        this.store = new Store<ConfigSchema>(fallbackOptions)
      } else {
        throw error
      }
    }
    this.localSecretKey = this.loadOrCreateLocalSecretKey()
    this.migrateLegacySafeStorageValues()
    this.migrateStartupConfiguration()
    if (!runningInWorker) {
      this.cacheMapStore = new CacheMapStore(
        this.getUserDataPath(),
        this.getOrCreateLocalCacheEncryptionKey()
      )
      this.migrateCacheMapKeys()
    }
  }

  /** 一次性迁移：把主配置中的 *CacheMap 大键搬到旁路存储，缩小配置文件 */
  private migrateCacheMapKeys(): void {
    if (!this.cacheMapStore || !this.cacheMapStore.isWritable()) return
    try {
      const all = this.store.store as unknown as Record<string, unknown>
      const cacheKeys = Object.keys(all).filter(isCacheMapKey)
      if (cacheKeys.length === 0) return
      for (const key of cacheKeys) {
        this.cacheMapStore.set(key, all[key])
        delete all[key]
      }
      // 先落盘旁路存储，再整体重写主配置（各一次全量写）
      this.cacheMapStore.flushSync()
      ;(this.store as any).store = all
    } catch (error) {
      console.error('ConfigService: 迁移 CacheMap 键失败', error)
    }
  }

  // === 状态查询 ===

  isLockMode(): boolean {
    const raw: any = this.store.get('decryptKey')
    return typeof raw === 'string' && raw.startsWith(LOCK_PREFIX)
  }

  isUnlocked(): boolean {
    return !this.isLockMode() || this.unlockedKeys.size > 0
  }

  isLocalSecretStorageAvailable(): boolean {
    return this.localSecretKey?.length === 32
  }

  isStoredWithLocalSecret(key: keyof ConfigSchema): boolean {
    const raw = this.store.get(key)
    return typeof raw === 'string' && raw.startsWith(LOCAL_PREFIX)
  }

  getLocalSecretStorageStatus(): {
    backend: 'local-file-aes-256-gcm-v1'
    available: boolean
    directoryMode: string | null
    directoryIsDirectory: boolean
    directorySymlink: boolean
    keyFileMode: string | null
    keyFileRegular: boolean
    keyFileSymlink: boolean
    keyLengthValid: boolean
    backupAvailable: boolean
    recoveredThisStart: boolean
    recoveryError: string
    localEncryptedValues: number
    legacySafeValues: number
  } {
    const { directory, keyPath } = this.getLocalSecretPaths()
    const raw = this.store.store as unknown as Record<string, unknown>
    const candidates: unknown[] = [
      ...[...ENCRYPTED_STRING_KEYS, ...ENCRYPTED_BOOL_KEYS, ...ENCRYPTED_NUMBER_KEYS, 'authHelloSecret']
        .map(key => raw[key])
    ]
    const wxidConfigs = raw.wxidConfigs
    if (wxidConfigs && typeof wxidConfigs === 'object' && !Array.isArray(wxidConfigs)) {
      for (const config of Object.values(wxidConfigs)) {
        if (!config || typeof config !== 'object' || Array.isArray(config)) continue
        const record = config as Record<string, unknown>
        candidates.push(record.decryptKey, record.imageAesKey, record.imageXorKey)
      }
    }
    let directoryMode: string | null = null
    let directoryIsDirectory = false
    let directorySymlink = false
    let keyFileMode: string | null = null
    let keyFileRegular = false
    let keyFileSymlink = false
    let keyLengthValid = false
    try {
      const info = lstatSync(directory)
      directoryMode = (info.mode & 0o777).toString(8).padStart(3, '0')
      directoryIsDirectory = info.isDirectory()
      directorySymlink = info.isSymbolicLink()
    } catch { /* missing/unreadable remains explicit */ }
    try {
      const info = lstatSync(keyPath)
      keyFileMode = (info.mode & 0o777).toString(8).padStart(3, '0')
      keyFileRegular = info.isFile()
      keyFileSymlink = info.isSymbolicLink()
      keyLengthValid = keyFileRegular && !keyFileSymlink && info.size === 32
    } catch { /* missing/unreadable remains explicit */ }
    return {
      backend: 'local-file-aes-256-gcm-v1',
      available: this.localSecretKey?.length === 32 && directoryIsDirectory &&
        !directorySymlink && keyLengthValid,
      directoryMode,
      directoryIsDirectory,
      directorySymlink,
      keyFileMode,
      keyFileRegular,
      keyFileSymlink,
      keyLengthValid,
      backupAvailable: this.localSecretRecovery.backupAvailable,
      recoveredThisStart: this.localSecretRecovery.recoveredThisStart,
      recoveryError: this.localSecretRecovery.error,
      localEncryptedValues: candidates.filter(value =>
        typeof value === 'string' && value.startsWith(LOCAL_PREFIX)).length,
      legacySafeValues: candidates.filter(value =>
        typeof value === 'string' && value.startsWith(SAFE_PREFIX)).length
    }
  }

  getOrCreateLocalCacheEncryptionKey(): string {
    if (!this.isLocalSecretStorageAvailable()) return ''
    const existing = String(this.get('localCacheEncryptionKey') || '')
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing
    const generated = crypto.randomBytes(32).toString('hex')
    this.set('localCacheEncryptionKey', generated)
    const verified = String(this.get('localCacheEncryptionKey') || '')
    return /^[a-f0-9]{64}$/i.test(verified) ? verified : ''
  }

  initializeLocalCacheEncryption(): string {
    const key = this.getOrCreateLocalCacheEncryptionKey()
    if (!key) return ''
    this.cacheMapStore?.initializeEncryption(key)
    this.migrateCacheMapKeys()
    return key
  }

  getCacheMapPrivacyStatus(): unknown {
    return this.cacheMapStore?.getPrivacyStatus() || null
  }

  // === get / set ===

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    if (this.cacheMapStore && isCacheMapKey(key as string)) {
      return this.cacheMapStore.get(key as string) as ConfigSchema[K]
    }
    const raw = this.store.get(key)

    if (ENCRYPTED_BOOL_KEYS.has(key)) {
      const str = typeof raw === 'string' ? raw : ''
      if (!str || (!str.startsWith(SAFE_PREFIX) && !str.startsWith(LOCAL_PREFIX))) return raw
      return (this.safeDecrypt(str) === 'true') as ConfigSchema[K]
    }

    if (ENCRYPTED_NUMBER_KEYS.has(key)) {
      const str = typeof raw === 'string' ? raw : ''
      if (!str) return raw
      if (str.startsWith(LOCK_PREFIX)) {
        const cached = this.unlockedKeys.get(key as string)
        return (cached !== undefined ? cached : 0) as ConfigSchema[K]
      }
      if (!str.startsWith(SAFE_PREFIX) && !str.startsWith(LOCAL_PREFIX)) return raw
      const num = Number(this.safeDecrypt(str))
      return (Number.isFinite(num) ? num : 0) as ConfigSchema[K]
    }

    if (ENCRYPTED_STRING_KEYS.has(key) && typeof raw === 'string') {
      if (key === 'authPassword') return this.safeDecrypt(raw) as ConfigSchema[K]
      if (raw.startsWith(LOCK_PREFIX)) {
        const cached = this.unlockedKeys.get(key as string)
        return (cached !== undefined ? cached : '') as ConfigSchema[K]
      }
      return this.safeDecrypt(raw) as ConfigSchema[K]
    }

    if (key === 'wxidConfigs' && raw && typeof raw === 'object') {
      return this.decryptWxidConfigs(raw as any) as ConfigSchema[K]
    }

    if (key === 'dbPath' && typeof raw === 'string') {
      return expandHomePath(raw) as ConfigSchema[K]
    }

    return raw
  }

  private encodeStoredValue<K extends keyof ConfigSchema>(
    key: K,
    value: ConfigSchema[K]
  ): ConfigSchema[K] {
    let toStore = value
    const inLockMode = this.isLockMode() && this.unlockPassword

    if (key === 'dbPath' && typeof value === 'string') {
      toStore = expandHomePath(value) as ConfigSchema[K]
    }

    if (ENCRYPTED_BOOL_KEYS.has(key)) {
      const boolValue = value === true || value === 'true'
      // `false` 保留为布尔值，无需生成加密载荷。
      toStore = (boolValue ? this.safeEncrypt('true') : false) as ConfigSchema[K]
    } else if (ENCRYPTED_NUMBER_KEYS.has(key)) {
      if (inLockMode && LOCKABLE_NUMBER_KEYS.has(key)) {
        toStore = this.lockEncrypt(String(value), this.unlockPassword!) as ConfigSchema[K]
        this.unlockedKeys.set(key as string, value)
      } else {
        toStore = this.safeEncrypt(String(value)) as ConfigSchema[K]
      }
    } else if (ENCRYPTED_STRING_KEYS.has(key) && typeof value === 'string') {
      if (key === 'authPassword') {
        toStore = this.safeEncrypt(value) as ConfigSchema[K]
      } else if (inLockMode && LOCKABLE_STRING_KEYS.has(key)) {
        toStore = this.lockEncrypt(value, this.unlockPassword!) as ConfigSchema[K]
        this.unlockedKeys.set(key as string, value)
      } else {
        toStore = this.safeEncrypt(value) as ConfigSchema[K]
      }
    } else if (key === 'wxidConfigs' && value && typeof value === 'object') {
      if (inLockMode) {
        toStore = this.lockEncryptWxidConfigs(value as any) as ConfigSchema[K]
      } else {
        toStore = this.encryptWxidConfigs(value as any) as ConfigSchema[K]
      }
    }

    return toStore
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    if (this.cacheMapStore && isCacheMapKey(key as string)) {
      this.cacheMapStore.set(key as string, value)
      return
    }
    this.store.set(key, this.encodeStoredValue(key, value))
  }

  setMany(values: Partial<ConfigSchema>): void {
    const entries = Object.entries(values) as Array<
      [keyof ConfigSchema, ConfigSchema[keyof ConfigSchema]]
    >
    if (!entries.length) return
    if (entries.some(([key]) => isCacheMapKey(String(key)))) {
      throw new Error('批量配置提交不支持旁路缓存字段')
    }
    const next = { ...(this.store.store as ConfigSchema) }
    for (const [key, value] of entries) {
      ;(next as any)[key] = this.encodeStoredValue(key, value as any)
    }
    ;(this.store as any).store = next
  }

  private commitStoredValues(values: Partial<ConfigSchema>): void {
    const next = { ...(this.store.store as ConfigSchema), ...values }
    ;(this.store as any).store = next
  }

  // === 加密/解密工具 ===

  private safeEncrypt(plaintext: string): string {
    if (!plaintext) return ''
    if (plaintext.startsWith(LOCAL_PREFIX) || plaintext.startsWith(SAFE_PREFIX)) return plaintext
    if (!this.localSecretKey) {
      throw new Error('本机主密钥不可用，敏感配置未写入；请先保留现场并检查隐私诊断')
    }
    const nonce = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.localSecretKey, nonce)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return LOCAL_PREFIX + Buffer.concat([nonce, tag, encrypted]).toString('base64')
  }

  private safeDecrypt(stored: string): string {
    if (!stored) return ''
    if (stored.startsWith(LOCAL_PREFIX)) {
      if (!this.localSecretKey) return ''
      try {
        const combined = Buffer.from(stored.slice(LOCAL_PREFIX.length), 'base64')
        if (combined.length < 29) return ''
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.localSecretKey, combined.subarray(0, 12))
        decipher.setAuthTag(combined.subarray(12, 28))
        return Buffer.concat([decipher.update(combined.subarray(28)), decipher.final()]).toString('utf8')
      } catch {
        return ''
      }
    }
    if (!stored.startsWith(SAFE_PREFIX)) return stored
    // 仅用于旧版 safe: 值的一次性迁移；新值永远不写入钥匙串。
    if (!isSafeStorageAvailable()) return ''
    try {
      const buf = Buffer.from(stored.slice(SAFE_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  }

  private loadOrCreateLocalSecretKey(): Buffer | null {
    const { directory, keyPath, backupPath } = this.getLocalSecretPaths()
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const directoryInfo = lstatSync(directory)
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return null
      chmodSync(directory, 0o700)
      const readValidKey = (path: string): Buffer | null => {
        if (!existsSync(path)) return null
        const info = lstatSync(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) return null
        chmodSync(path, 0o600)
        const value = readFileSync(path)
        return value.length === 32 ? value : null
      }
      let key = readValidKey(keyPath)
      const backup = readValidKey(backupPath)
      if (!key && !existsSync(keyPath) && backup) {
        const temporaryPath = `${keyPath}.recovering-${process.pid}`
        writeFileSync(temporaryPath, backup, { flag: 'wx', mode: 0o600 })
        renameSync(temporaryPath, keyPath)
        key = readValidKey(keyPath)
        this.localSecretRecovery.recoveredThisStart = Boolean(key)
      }
      if (!key && existsSync(keyPath)) {
        this.localSecretRecovery.error = '本机主密钥文件损坏或类型异常，已保留现场'
        return null
      }
      if (!key && this.hasPersistedLocalCiphertext()) {
        this.localSecretRecovery.error = '已存在本机加密配置，但主密钥及恢复副本均缺失'
        return null
      }
      if (!key) {
        try {
          writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 })
        } catch (error: any) {
          if (error?.code !== 'EEXIST') throw error
        }
        key = readValidKey(keyPath)
      }
      if (!key) return null
      if (!backup) {
        const temporaryBackup = `${backupPath}.writing-${process.pid}`
        writeFileSync(temporaryBackup, key, { flag: 'wx', mode: 0o600 })
        renameSync(temporaryBackup, backupPath)
      } else if (!crypto.timingSafeEqual(key, backup)) {
        this.localSecretRecovery.error = '本机主密钥与恢复副本不一致，已保留两份现场'
        return null
      }
      this.localSecretRecovery.backupAvailable = Boolean(readValidKey(backupPath))
      return key
    } catch (error) {
      console.error('ConfigService: 本机密钥文件初始化失败', error)
      return null
    }
  }

  private hasPersistedLocalCiphertext(): boolean {
    const contains = (value: unknown): boolean => {
      if (typeof value === 'string') return value.startsWith(LOCAL_PREFIX)
      if (!value || typeof value !== 'object') return false
      return Object.values(value as Record<string, unknown>).some(contains)
    }
    try { return contains(this.store.store) } catch { return true }
  }

  private getLocalSecretPaths(): { directory: string; keyPath: string; backupPath: string } {
    const directory = join(this.getUserDataPath(), 'secrets')
    return {
      directory,
      keyPath: join(directory, 'local-master-key.bin'),
      backupPath: join(directory, 'local-master-key.recovery.bin')
    }
  }

  private migrateLegacySafeStorageValues(): void {
    if (!this.localSecretKey) return
    const migrate = (value: unknown): unknown => {
      if (typeof value !== 'string' || !value.startsWith(SAFE_PREFIX)) return value
      const plaintext = this.safeDecrypt(value)
      return plaintext ? this.safeEncrypt(plaintext) : value
    }
    try {
      const next = { ...(this.store.store as unknown as Record<string, unknown>) }
      let changed = false
      for (const key of [...ENCRYPTED_STRING_KEYS, ...ENCRYPTED_BOOL_KEYS, ...ENCRYPTED_NUMBER_KEYS, 'authHelloSecret']) {
        const migrated = migrate(next[key])
        if (migrated !== next[key]) {
          next[key] = migrated
          changed = true
        }
      }
      const wxidConfigs = next.wxidConfigs
      if (wxidConfigs && typeof wxidConfigs === 'object' && !Array.isArray(wxidConfigs)) {
        const migratedConfigs = structuredClone(wxidConfigs as Record<string, unknown>)
        for (const rawConfig of Object.values(migratedConfigs)) {
          if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue
          for (const key of ['decryptKey', 'imageAesKey', 'imageXorKey']) {
            const record = rawConfig as Record<string, unknown>
            const migrated = migrate(record[key])
            if (migrated !== record[key]) {
              record[key] = migrated
              changed = true
            }
          }
        }
        if (changed) next.wxidConfigs = migratedConfigs
      }
      if (changed) (this.store as any).store = next
    } catch (error) {
      // 旧值解密失败时原样保留，不得用新密钥覆盖旧加密数据。
      console.error('ConfigService: 旧 Safe Storage 配置迁移未完成', error)
    }
  }

  private lockEncrypt(plaintext: string, password: string): string {
    if (!plaintext) return ''
    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(12)
    const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    const combined = Buffer.concat([salt, iv, authTag, encrypted])
    return LOCK_PREFIX + combined.toString('base64')
  }

  private lockDecrypt(stored: string, password: string): string | null {
    if (!stored || !stored.startsWith(LOCK_PREFIX)) return null
    try {
      const combined = Buffer.from(stored.slice(LOCK_PREFIX.length), 'base64')
      const salt = combined.subarray(0, 16)
      const iv = combined.subarray(16, 28)
      const authTag = combined.subarray(28, 44)
      const ciphertext = combined.subarray(44)
      const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return decrypted.toString('utf8')
    } catch {
      return null
    }
  }

  // 通过尝试解密 lock: 字段来验证密码是否正确（当 authPassword 被删除时使用）
  private verifyPasswordByDecrypt(password: string): boolean {
    // 依次尝试解密任意一个 lock: 字段，GCM authTag 会验证密码正确性
    const lockFields = ['decryptKey', 'imageAesKey', 'imageXorKey'] as const
    for (const key of lockFields) {
      const raw: any = this.store.get(key as any)
      if (typeof raw === 'string' && raw.startsWith(LOCK_PREFIX)) {
        const result = this.lockDecrypt(raw, password)
        // lockDecrypt 返回 null 表示解密失败（密码错误），非 null 表示成功
        return result !== null
      }
    }
    return false
  }

  // === wxidConfigs 加密/解密 ===

  private encryptWxidConfigs(configs: ConfigSchema['wxidConfigs']): ConfigSchema['wxidConfigs'] {
    const result: ConfigSchema['wxidConfigs'] = {}
    for (const [wxid, cfg] of Object.entries(configs)) {
      result[wxid] = { ...cfg }
      if (cfg.decryptKey) result[wxid].decryptKey = this.safeEncrypt(cfg.decryptKey)
      if (cfg.imageAesKey) result[wxid].imageAesKey = this.safeEncrypt(cfg.imageAesKey)
      if (cfg.imageXorKey !== undefined) {
        (result[wxid] as any).imageXorKey = this.safeEncrypt(String(cfg.imageXorKey))
      }
    }
    return result
  }

  private decryptLockedWxidConfigs(password: string): void {
    const wxidConfigs = this.store.get('wxidConfigs')
    if (!wxidConfigs || typeof wxidConfigs !== 'object') return
    for (const [wxid, cfg] of Object.entries(wxidConfigs) as [string, any][]) {
      if (cfg.decryptKey && typeof cfg.decryptKey === 'string' && cfg.decryptKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(cfg.decryptKey, password)
        if (d !== null) this.unlockedKeys.set(`wxid:${wxid}:decryptKey`, d)
      }
      if (cfg.imageAesKey && typeof cfg.imageAesKey === 'string' && cfg.imageAesKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(cfg.imageAesKey, password)
        if (d !== null) this.unlockedKeys.set(`wxid:${wxid}:imageAesKey`, d)
      }
      if (cfg.imageXorKey && typeof cfg.imageXorKey === 'string' && cfg.imageXorKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(cfg.imageXorKey, password)
        if (d !== null) this.unlockedKeys.set(`wxid:${wxid}:imageXorKey`, Number(d))
      }
    }
  }

  private decryptWxidConfigs(configs: ConfigSchema['wxidConfigs']): ConfigSchema['wxidConfigs'] {
    const result: ConfigSchema['wxidConfigs'] = {}
    for (const [wxid, cfg] of Object.entries(configs) as [string, any][]) {
      result[wxid] = { ...cfg, updatedAt: cfg.updatedAt }
      // decryptKey
      if (typeof cfg.decryptKey === 'string') {
        if (cfg.decryptKey.startsWith(LOCK_PREFIX)) {
          result[wxid].decryptKey = this.unlockedKeys.get(`wxid:${wxid}:decryptKey`) ?? ''
        } else {
          result[wxid].decryptKey = this.safeDecrypt(cfg.decryptKey)
        }
      }
      // imageAesKey
      if (typeof cfg.imageAesKey === 'string') {
        if (cfg.imageAesKey.startsWith(LOCK_PREFIX)) {
          result[wxid].imageAesKey = this.unlockedKeys.get(`wxid:${wxid}:imageAesKey`) ?? ''
        } else {
          result[wxid].imageAesKey = this.safeDecrypt(cfg.imageAesKey)
        }
      }
      // imageXorKey
      if (typeof cfg.imageXorKey === 'string') {
        if (cfg.imageXorKey.startsWith(LOCK_PREFIX)) {
          result[wxid].imageXorKey = this.unlockedKeys.get(`wxid:${wxid}:imageXorKey`) ?? 0
        } else if (cfg.imageXorKey.startsWith(SAFE_PREFIX) || cfg.imageXorKey.startsWith(LOCAL_PREFIX)) {
          const num = Number(this.safeDecrypt(cfg.imageXorKey))
          result[wxid].imageXorKey = Number.isFinite(num) ? num : 0
        }
      }
    }
    return result
  }
  private lockEncryptWxidConfigs(
    configs: ConfigSchema['wxidConfigs'],
    password = this.unlockPassword!
  ): ConfigSchema['wxidConfigs'] {
    const result: ConfigSchema['wxidConfigs'] = {}
    for (const [wxid, cfg] of Object.entries(configs)) {
      result[wxid] = { ...cfg }
      if (cfg.decryptKey) result[wxid].decryptKey = this.lockEncrypt(cfg.decryptKey, password) as any
      if (cfg.imageAesKey) result[wxid].imageAesKey = this.lockEncrypt(cfg.imageAesKey, password) as any
      if (cfg.imageXorKey !== undefined) {
        (result[wxid] as any).imageXorKey = this.lockEncrypt(String(cfg.imageXorKey), password)
      }
    }
    return result
  }

  // === 业务方法 ===

  enableLock(password: string): { success: boolean; error?: string } {
    try {
      // 先读取当前所有明文密钥
      const decryptKey = this.get('decryptKey')
      const imageAesKey = this.get('imageAesKey')
      const imageXorKey = this.get('imageXorKey')
      const wxidConfigs = this.get('wxidConfigs')

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
      const stored: Partial<ConfigSchema> = {
        authPassword: this.safeEncrypt(passwordHash) as any,
        authEnabled: this.safeEncrypt('true') as any,
        decryptKey: decryptKey ? this.lockEncrypt(String(decryptKey), password) as any : '',
        imageAesKey: imageAesKey ? this.lockEncrypt(String(imageAesKey), password) as any : '',
        imageXorKey: this.lockEncrypt(String(imageXorKey), password) as any,
        wxidConfigs: this.lockEncryptWxidConfigs(wxidConfigs, password)
      }
      this.commitStoredValues(stored)

      const unlocked = new Map<string, any>([
        ['decryptKey', decryptKey], ['imageAesKey', imageAesKey], ['imageXorKey', imageXorKey]
      ])
      for (const [wxid, cfg] of Object.entries(wxidConfigs)) {
        if (cfg.decryptKey) unlocked.set(`wxid:${wxid}:decryptKey`, cfg.decryptKey)
        if (cfg.imageAesKey) unlocked.set(`wxid:${wxid}:imageAesKey`, cfg.imageAesKey)
        if (cfg.imageXorKey !== undefined) unlocked.set(`wxid:${wxid}:imageXorKey`, cfg.imageXorKey)
      }
      this.unlockedKeys = unlocked
      this.unlockPassword = password

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  unlock(password: string): { success: boolean; error?: string } {
    try {
      // 验证密码
      const storedHash = this.safeDecrypt(this.store.get('authPassword') as any)
      const inputHash = crypto.createHash('sha256').update(password).digest('hex')

      if (storedHash && storedHash !== inputHash) {
        // authPassword 存在但密码不匹配
        return { success: false, error: '密码错误' }
      }

      if (!storedHash) {
        // authPassword 被删除/损坏，尝试用密码直接解密 lock: 字段来验证
        const verified = this.verifyPasswordByDecrypt(password)
        if (!verified) {
          return { success: false, error: '密码错误' }
        }
        // 密码正确，自愈 authPassword
        const newHash = crypto.createHash('sha256').update(password).digest('hex')
        this.store.set('authPassword', this.safeEncrypt(newHash) as any)
        this.store.set('authEnabled', this.safeEncrypt('true') as any)
      }

      // 先在临时缓存中认证全部 lock: 字段；任一字段损坏都不得提交半解锁状态。
      const decrypted = new Map<string, any>()
      const rawDecryptKey: any = this.store.get('decryptKey')
      if (typeof rawDecryptKey === 'string' && rawDecryptKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(rawDecryptKey, password)
        if (d === null) return { success: false, error: '应用锁加密数据校验失败，未执行半解锁' }
        decrypted.set('decryptKey', d)
      }

      const rawImageAesKey: any = this.store.get('imageAesKey')
      if (typeof rawImageAesKey === 'string' && rawImageAesKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(rawImageAesKey, password)
        if (d === null) return { success: false, error: '应用锁加密数据校验失败，未执行半解锁' }
        decrypted.set('imageAesKey', d)
      }

      const rawImageXorKey: any = this.store.get('imageXorKey')
      if (typeof rawImageXorKey === 'string' && rawImageXorKey.startsWith(LOCK_PREFIX)) {
        const d = this.lockDecrypt(rawImageXorKey, password)
        if (d === null || !Number.isFinite(Number(d))) {
          return { success: false, error: '应用锁加密数据校验失败，未执行半解锁' }
        }
        decrypted.set('imageXorKey', Number(d))
      }

      const wxidConfigs = this.store.get('wxidConfigs')
      if (wxidConfigs && typeof wxidConfigs === 'object') {
        for (const [wxid, cfg] of Object.entries(wxidConfigs) as [string, any][]) {
          for (const [field, numeric] of [['decryptKey', false], ['imageAesKey', false], ['imageXorKey', true]] as const) {
            const raw = cfg?.[field]
            if (typeof raw !== 'string' || !raw.startsWith(LOCK_PREFIX)) continue
            const value = this.lockDecrypt(raw, password)
            if (value === null || (numeric && !Number.isFinite(Number(value)))) {
              return { success: false, error: '应用锁加密数据校验失败，未执行半解锁' }
            }
            decrypted.set(`wxid:${wxid}:${field}`, numeric ? Number(value) : value)
          }
        }
      }

      // 保留密码供 set() 使用
      this.unlockedKeys.clear()
      for (const [key, value] of decrypted) this.unlockedKeys.set(key, value)
      this.unlockPassword = password
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  disableLock(password: string): { success: boolean; error?: string } {
    try {
      // 验证密码
      const storedHash = this.safeDecrypt(this.store.get('authPassword') as any)
      const inputHash = crypto.createHash('sha256').update(password).digest('hex')
      if (storedHash !== inputHash) {
        return { success: false, error: '密码错误' }
      }

      if (this.unlockedKeys.size === 0) {
        const unlocked = this.unlock(password)
        if (!unlocked.success) return unlocked
      }

      const decryptKey = this.unlockedKeys.get('decryptKey')
      const imageAesKey = this.unlockedKeys.get('imageAesKey')
      const imageXorKey = this.unlockedKeys.get('imageXorKey')

      const wxidConfigs = this.get('wxidConfigs')
      this.commitStoredValues({
        decryptKey: decryptKey ? this.safeEncrypt(String(decryptKey)) as any : '',
        imageAesKey: imageAesKey ? this.safeEncrypt(String(imageAesKey)) as any : '',
        imageXorKey: imageXorKey !== undefined ? this.safeEncrypt(String(imageXorKey)) as any : 0,
        wxidConfigs: this.encryptWxidConfigs(wxidConfigs),
        authEnabled: false,
        authPassword: '',
        authUseHello: false,
        authHelloSecret: ''
      })

      // 清除运行时状态
      this.unlockedKeys.clear()
      this.unlockPassword = null

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  changePassword(oldPassword: string, newPassword: string): { success: boolean; error?: string } {
    try {
      // 验证旧密码
      const storedHash = this.safeDecrypt(this.store.get('authPassword') as any)
      const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex')
      if (storedHash !== oldHash) {
        return { success: false, error: '旧密码错误' }
      }

      // 确保已解锁
      if (this.unlockedKeys.size === 0) {
        const unlocked = this.unlock(oldPassword)
        if (!unlocked.success) return unlocked
      }

      const decryptKey = this.unlockedKeys.get('decryptKey')
      const imageAesKey = this.unlockedKeys.get('imageAesKey')
      const imageXorKey = this.unlockedKeys.get('imageXorKey')

      const wxidConfigs = this.get('wxidConfigs')
      const newHash = crypto.createHash('sha256').update(newPassword).digest('hex')
      const useHello = this.get('authUseHello')
      this.commitStoredValues({
        decryptKey: decryptKey ? this.lockEncrypt(String(decryptKey), newPassword) as any : '',
        imageAesKey: imageAesKey ? this.lockEncrypt(String(imageAesKey), newPassword) as any : '',
        imageXorKey: imageXorKey !== undefined ? this.lockEncrypt(String(imageXorKey), newPassword) as any : 0,
        wxidConfigs: this.lockEncryptWxidConfigs(wxidConfigs, newPassword),
        authPassword: this.safeEncrypt(newHash) as any,
        ...(useHello ? { authHelloSecret: this.safeEncrypt(newPassword) as any } : {})
      })

      this.unlockPassword = newPassword
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  // === Hello 相关 ===

  setHelloSecret(password: string): void {
    this.commitStoredValues({
      authHelloSecret: this.safeEncrypt(password) as any,
      authUseHello: this.safeEncrypt('true') as any
    })
  }

  getHelloSecret(): string {
    const raw: any = this.store.get('authHelloSecret')
    if (!raw || typeof raw !== 'string') return ''
    return this.safeDecrypt(raw)
  }

  clearHelloSecret(): void {
    this.commitStoredValues({ authHelloSecret: '', authUseHello: false })
  }

  // === 迁移 ===

  private migrateStartupConfiguration(): void {
    const next = structuredClone(this.store.store as ConfigSchema)
    let changed = false
    const replace = (key: keyof ConfigSchema, value: unknown): void => {
      if ((next as any)[key] === value) return
      ;(next as any)[key] = value
      changed = true
    }

    // 将旧版明文 auth 字段迁移为本机密钥加密格式。
    const rawEnabled: any = next.authEnabled
    if (rawEnabled === true || rawEnabled === 'true') {
      replace('authEnabled', this.safeEncrypt('true'))
    } else if (rawEnabled === false || rawEnabled === 'false') {
      // 保持 false 为明文布尔，避免无意义的加密写入。
      replace('authEnabled', false)
    }

    const rawUseHello: any = next.authUseHello
    if (rawUseHello === true || rawUseHello === 'true') {
      replace('authUseHello', this.safeEncrypt('true'))
    } else if (rawUseHello === false || rawUseHello === 'false') {
      replace('authUseHello', false)
    }

    const rawPassword: any = next.authPassword
    if (typeof rawPassword === 'string' && rawPassword &&
        !rawPassword.startsWith(SAFE_PREFIX) && !rawPassword.startsWith(LOCAL_PREFIX)) {
      replace('authPassword', this.safeEncrypt(rawPassword))
    }

    // 所有敏感字符串都必须迁移；兼容字段即使已复制到新字段，也不能留下明文副本。
    for (const key of ENCRYPTED_STRING_KEYS) {
      const raw: any = next[key]
      if (typeof raw === 'string' && raw && !raw.startsWith(SAFE_PREFIX) &&
          !raw.startsWith(LOCAL_PREFIX) && !raw.startsWith(LOCK_PREFIX)) {
        replace(key, this.safeEncrypt(raw))
      }
    }

    const rawXor: any = next.imageXorKey
    if (typeof rawXor === 'number' && rawXor !== 0) {
      replace('imageXorKey', this.safeEncrypt(String(rawXor)))
    }

    const wxidConfigs: any = next.wxidConfigs
    if (wxidConfigs && typeof wxidConfigs === 'object') {
      for (const [_wxid, cfg] of Object.entries(wxidConfigs) as [string, any][]) {
        if (cfg.decryptKey && typeof cfg.decryptKey === 'string' && !cfg.decryptKey.startsWith(SAFE_PREFIX) && !cfg.decryptKey.startsWith(LOCAL_PREFIX) && !cfg.decryptKey.startsWith(LOCK_PREFIX)) {
          cfg.decryptKey = this.safeEncrypt(cfg.decryptKey)
          changed = true
        }
        if (cfg.imageAesKey && typeof cfg.imageAesKey === 'string' && !cfg.imageAesKey.startsWith(SAFE_PREFIX) && !cfg.imageAesKey.startsWith(LOCAL_PREFIX) && !cfg.imageAesKey.startsWith(LOCK_PREFIX)) {
          cfg.imageAesKey = this.safeEncrypt(cfg.imageAesKey)
          changed = true
        }
        if (typeof cfg.imageXorKey === 'number' && cfg.imageXorKey !== 0) {
          cfg.imageXorKey = this.safeEncrypt(String(cfg.imageXorKey))
          changed = true
        }
      }
    }

    const decode = (value: unknown): string => this.safeDecrypt(String(value || '')).trim()
    const sharedBaseUrl = decode(next.aiModelApiBaseUrl)
    const sharedApiKey = decode(next.aiModelApiKey)
    const sharedModel = decode(next.aiModelApiModel)

    const legacyBaseUrl = decode(next.aiInsightApiBaseUrl)
    const legacyApiKey = decode(next.aiInsightApiKey)
    const legacyModel = decode(next.aiInsightApiModel)

    if (!sharedBaseUrl && legacyBaseUrl) replace('aiModelApiBaseUrl', this.safeEncrypt(legacyBaseUrl))
    if (!sharedApiKey && legacyApiKey) replace('aiModelApiKey', this.safeEncrypt(legacyApiKey))
    if (!sharedModel && legacyModel) replace('aiModelApiModel', this.safeEncrypt(legacyModel))

    const groupSummaryFilterMode = String(next.aiGroupSummaryFilterMode || '').trim()
    if (groupSummaryFilterMode === 'blacklist') {
      next.aiGroupSummaryFilterList = []
      next.aiGroupSummaryFilterMode = 'whitelist'
      changed = true
    }
    if (changed) (this.store as any).store = next
  }

  // === 验证 ===

  verifyAuthEnabled(): boolean {
    // 先检查 authEnabled 字段
    const rawEnabled: any = this.store.get('authEnabled')
    if (typeof rawEnabled === 'string' &&
        (rawEnabled.startsWith(SAFE_PREFIX) || rawEnabled.startsWith(LOCAL_PREFIX))) {
      if (this.safeDecrypt(rawEnabled) === 'true') return true
    }

    // 即使 authEnabled 被删除/篡改，如果密钥是 lock: 格式，说明曾开启过应用锁
    const rawDecryptKey: any = this.store.get('decryptKey')
    return typeof rawDecryptKey === 'string' && rawDecryptKey.startsWith(LOCK_PREFIX);


  }

  // === 工具方法 ===

  /**
   * 获取当前用户 wxid（清洗后，不带后缀）
   */
  getMyWxidCleaned(): string {
    const wxid = this.get('myWxid')
    return wxid ? this.cleanAccountDirName(wxid) : ''
  }

  /**
   * 获取当前 wxid 对应的图片密钥，优先从 wxidConfigs 中取，找不到则回退到全局配置
   */
  getImageKeysForCurrentWxid(): { xorKey: unknown; aesKey: string } {
    const wxid = this.get('myWxid')
    if (wxid) {
      const wxidConfigs = this.get('wxidConfigs')
      const cfg = wxidConfigs?.[wxid]
      if (cfg && (cfg.imageXorKey !== undefined || cfg.imageAesKey)) {
        return {
          xorKey: cfg.imageXorKey ?? this.get('imageXorKey'),
          aesKey: cfg.imageAesKey ?? this.get('imageAesKey')
        }
      }
    }
    return {
      xorKey: this.get('imageXorKey'),
      aesKey: this.get('imageAesKey')
    }
  }

  /**
   * 清理账号目录名称（移除后缀）
   */
  private cleanAccountDirName(dirName: string): string {
    const trimmed = dirName.trim()
    if (!trimmed) return trimmed

    // wxid_ 开头的特殊处理
    if (trimmed.toLowerCase().startsWith('wxid_')) {
      const match = trimmed.match(/^(wxid_[^_]+)/i)
      if (match) return match[1]
      return trimmed
    }

    // 移除4位后缀
    const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
    if (suffixMatch) return suffixMatch[1]

    return trimmed
  }

  /**
   * 检查是否是目录
   */
  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }

  /**
   * 浅层判定一个目录"看起来像不像账号目录"：
   *   存在 db_storage 子目录，或存在 FileStorage/Image[2] 子目录之一即认为是。
   *
   * 用于在 {@link getAccountDir} 候选阶段剔除"同名但实际无数据"的残留空目录
   * （例如自定义微信号后微信遗留下来的旧 wxid 主目录）。
   */
  private accountDirLooksValid(entryPath: string): boolean {
    return (
      existsSync(join(entryPath, 'db_storage')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image2'))
    )
  }

  /**
   * 检测账号目录下是否存在 session.db。
   *
   * 是排序优先级里"区分真实写入数据 vs 仅有空 db_storage 骨架"的关键判据，
   * 同时兼容微信 4.x 两种已知布局：
   *   - db_storage/session/session.db （新版本嵌套布局）
   *   - db_storage/session.db          （部分版本扁平布局）
   */
  private accountDirHasSessionDb(entryPath: string): boolean {
    const candidates = [
      join(entryPath, 'db_storage', 'session', 'session.db'),
      join(entryPath, 'db_storage', 'session.db'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return true
    }
    return false
  }

  /**
   * 获取账号目录的真实绝对路径。
   *
   * 这是 WeFlow 统一的账号目录解析入口，所有服务都应通过本方法获取
   * 账号目录，而不要自行拼接 `join(dbPath, wxid)`。
   *
   * ## 修复 #996（错误码 -3001：未找到数据库目录）
   *
   * ### 旧实现存在的两处严重缺陷
   * 1. **对 wxid_ 开头强制要求"带后缀"**：
   *    未自定义微信号的普通用户，目录就叫 `wxid_X`（无任何后缀），
   *    旧逻辑把它过滤掉，导致这类用户根本匹配不到自己的账号目录。
   *
   * 2. **对非 wxid_ 开头（自定义微信号）走短路返回，不校验目录有效性**：
   *    旧实现写法是
   *      ```ts
   *      if (!lowerWxid.startsWith('wxid_')) {
   *        const direct = join(root, cleanedWxid)
   *        if (existsSync(direct)) return direct  // ← 直接返回，没校验里面有没有 db_storage
   *      }
   *      ```
   *    叠加 {@link cleanAccountDirName} 会把 `<自定义号>_<4位后缀>` 清洗成
   *    `<自定义号>`，于是无论用户保存的是哪个 wxid，都会命中旧的、
   *    无后缀的空目录（它真实存在但里面没有 db_storage），最终在
   *    wcdbCore.open 阶段触发 -3001。
   *
   * ### 修复后的统一匹配流程
   * 1. 扫描 dbPath 下所有子目录；
   * 2. 同时接受**精确匹配**(`entry == cleanedWxid`) 与
   *    **后缀匹配**(`entry.startsWith(cleanedWxid + '_')`) 两种命中方式；
   * 3. 用 {@link accountDirLooksValid} 过滤掉"看起来根本不像账号目录"的项；
   * 4. 在剩余候选中按以下优先级排序，取最优：
   *    - **有 session.db** > 没有：区分"真正写入数据"与"残留空目录"；
   *    - **后缀匹配** > 精确匹配：与微信 4.x 实际写入目录的命名习惯一致；
   *    - **修改时间更新** > 更旧：兜底。
   *
   * @param dbPath 数据库根目录（可选，默认从配置读取 `dbPath`）
   * @param wxid 微信 ID（可选，默认从配置读取 `myWxid`）
   * @returns 账号目录的完整绝对路径；找不到返回 null
   */
  getAccountDir(dbPath?: string, wxid?: string): string | null {
    const actualDbPath = dbPath || this.get('dbPath')
    const actualWxid = wxid || this.get('myWxid')

    if (!actualDbPath || !actualWxid) return null

    const cleanedWxid = this.cleanAccountDirName(actualWxid)
    const normalized = actualDbPath.replace(/[\\/]+$/, '')
    const cacheKey = `${normalized}|${cleanedWxid.toLowerCase()}`

    // 命中缓存且目标仍存在则直接返回；目标已被删除的过期缓存项会被剔除
    const cached = this.accountDirCache.get(cacheKey)
    if (cached && existsSync(cached)) return cached
    if (cached && !existsSync(cached)) {
      this.accountDirCache.delete(cacheKey)
    }

    const lowerWxid = cleanedWxid.toLowerCase()

    try {
      const entries = readdirSync(normalized)
      type Candidate = { entryPath: string; isExact: boolean; hasSession: boolean; mtime: number }
      const candidates: Candidate[] = []

      for (const entry of entries) {
        const entryPath = join(normalized, entry)
        if (!this.isDirectory(entryPath)) continue

        const lowerEntry = entry.toLowerCase()
        const isExactMatch = lowerEntry === lowerWxid
        const isSuffixMatch = lowerEntry.startsWith(`${lowerWxid}_`)
        // 既不是精确命中、也不是前缀命中 → 与本 wxid 无关，跳过
        if (!isExactMatch && !isSuffixMatch) continue

        // 看起来不像账号目录（连 db_storage 与 FileStorage/Image 都没有）→ 跳过
        // 这一步是修复 #996 的关键：自定义微信号场景下旧的、无后缀空目录
        // 会在这里被过滤掉，避免后续 wcdbCore.open 误判为真实账号目录。
        if (!this.accountDirLooksValid(entryPath)) continue

        let mtime = 0
        try { mtime = statSync(entryPath).mtimeMs } catch { /* 忽略 stat 异常 */ }
        candidates.push({
          entryPath,
          isExact: isExactMatch,
          hasSession: this.accountDirHasSessionDb(entryPath),
          mtime,
        })
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          // 1) 优先选有 session.db 的（真实写入数据的目录）
          if (a.hasSession !== b.hasSession) return a.hasSession ? -1 : 1
          // 2) 其次优先选"带后缀"的（更接近微信 4.x 实际写入目录）
          if (a.isExact !== b.isExact) return a.isExact ? 1 : -1
          // 3) 最后按修改时间倒序（最新的优先）
          return b.mtime - a.mtime
        })
        const best = candidates[0].entryPath
        this.accountDirCache.set(cacheKey, best)
        return best
      }
    } catch { }

    return null
  }

  private getUserDataPath(): string {
    const workerUserDataPath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    if (workerUserDataPath) {
      return workerUserDataPath
    }
    return app?.getPath?.('userData') || process.cwd()
  }

  getCacheBasePath(): string {
    return join(this.getUserDataPath(), 'cache')
  }

  getAll(): Partial<ConfigSchema> {
    const all = { ...this.store.store } as Record<string, unknown>
    if (this.cacheMapStore) {
      Object.assign(all, this.cacheMapStore.entries())
    }
    return all as Partial<ConfigSchema>
  }

  clear(): void {
    this.store.clear()
    this.cacheMapStore?.clear()
    this.unlockedKeys.clear()
    this.unlockPassword = null
  }
}
