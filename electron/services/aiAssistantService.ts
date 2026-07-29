import { app } from 'electron'
import crypto from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { ConfigService } from './config'
import { httpService } from './httpService'
import { showSystemNotification } from './systemNotificationService'

type AssistantTask = {
  id: string
  title: string
  detail: string
  owner: string
  due: string
  priority: 'high' | 'medium' | 'low'
  source: string
  confidence: number
  status: 'todo' | 'doing' | 'done'
  createdAt?: string
  updatedAt?: string
}

type AssistantState = {
  version: 2
  briefings: Record<string, any>
  tasks: AssistantTask[]
  lastSyncAt: string | null
  cursor: {
    lastMessageTimestamp: number
    recentMessageIds: string[]
    sessionCursors: Record<string, number>
    lastSuccessfulRunAt: string | null
    lastScheduledRunDate: string | null
    lastAttemptAt: string | null
    lastError: string | null
  }
}

const EMPTY_STATE: AssistantState = {
  version: 2,
  briefings: {},
  tasks: [],
  lastSyncAt: null,
  cursor: {
    lastMessageTimestamp: 0,
    recentMessageIds: [],
    sessionCursors: {},
    lastSuccessfulRunAt: null,
    lastScheduledRunDate: null,
    lastAttemptAt: null,
    lastError: null
  }
}

const SYSTEM_PROMPT = `你是一位谨慎、高效的中文私人助理。请从新增微信消息中提取真正可执行的待办和重要信息。
只根据消息证据，不臆测；合并跨日重复事项；title 用动词开头；不确定日期时 due 为空；source 使用会话显示名。
只返回 JSON：
{"headline":"标题","summary":"摘要","highlights":["重要信息"],"tasks":[{"title":"待办","detail":"上下文","owner":"我","due":"","priority":"high|medium|low","source":"会话名","confidence":0.8}]}`

function shanghaiDate(timestampMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestampMs))
}

function messageKey(message: any): string {
  return `${message.sessionId}:${message.id}`
}

function stableTaskId(task: any): string {
  const value = [task.title, task.source, task.due].map(item => String(item || '').trim().toLowerCase()).join('|')
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)
}

function parseModelJson(text: string): any {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw
  try {
    return JSON.parse(fenced)
  } catch {
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(fenced.slice(start, end + 1))
    throw new Error('模型没有返回有效 JSON')
  }
}

function redact(text: string): string {
  return String(text || '')
    .replace(/\bsk-[A-Za-z0-9._-]{12,}\b/g, '[已隐藏的 API Key]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[已隐藏的长令牌]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[已隐藏的邮箱]')
}

export class AiAssistantService {
  private config = ConfigService.getInstance()
  private state: AssistantState = structuredClone(EMPTY_STATE)
  private statePath = ''
  private activeSync: Promise<any> | null = null
  private scheduler: ReturnType<typeof setInterval> | null = null
  private lastSchedulerAttemptAt = 0

  async initialize(): Promise<void> {
    this.statePath = join(app.getPath('userData'), 'ai-assistant-state.json')
    this.migrateLegacyData()
    this.loadState()
    this.scheduler = setInterval(() => void this.schedulerTick(), 60_000)
    this.scheduler.unref()
    if (this.config.get('aiAssistantEnabled')) {
      setTimeout(() => void this.sync().catch(() => undefined), 5_000)
    }
  }

  dispose(): void {
    if (this.scheduler) clearInterval(this.scheduler)
    this.scheduler = null
  }

  private migrateLegacyData(): void {
    const legacyRoot = join(app.getAppPath(), 'daily-ai-assistant')
    const legacyState = join(legacyRoot, 'data', 'state.json')
    if (!existsSync(this.statePath) && existsSync(legacyState)) {
      mkdirSync(dirname(this.statePath), { recursive: true })
      writeFileSync(this.statePath, readFileSync(legacyState))
    }
    if (!this.config.get('aiAssistantApiKey')) {
      const envPath = join(legacyRoot, '.env')
      if (existsSync(envPath)) {
        const match = readFileSync(envPath, 'utf8').match(/^AI_API_KEY=(.+)$/m)
        if (match?.[1]?.trim()) {
          this.config.set('aiAssistantApiKey', match[1].trim())
          try { unlinkSync(envPath) } catch {}
        }
      }
    }
  }

  private loadState(): void {
    try {
      const loaded = JSON.parse(readFileSync(this.statePath, 'utf8'))
      this.state = {
        ...structuredClone(EMPTY_STATE),
        ...loaded,
        version: 2,
        cursor: { ...structuredClone(EMPTY_STATE.cursor), ...(loaded.cursor || {}) },
        tasks: Array.isArray(loaded.tasks) ? loaded.tasks : []
      }
    } catch {
      this.state = structuredClone(EMPTY_STATE)
    }
  }

  private saveState(): void {
    mkdirSync(dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.statePath)
  }

  private async ensureHttpApi(): Promise<{ port: number; token: string }> {
    let token = String(this.config.get('httpApiToken') || '').trim()
    if (!token) {
      token = crypto.randomBytes(32).toString('hex')
      this.config.set('httpApiToken', token)
    }
    const port = Number(this.config.get('httpApiPort')) || 5031
    if (!httpService.isRunning()) {
      const result = await httpService.start(port, '127.0.0.1')
      if (!result.success) throw new Error(result.error || '无法启动 WeFlow 数据接口')
    }
    return { port, token }
  }

  private async api(path: string, params: Record<string, any> = {}): Promise<any> {
    const { port, token } = await this.ensureHttpApi()
    const url = new URL(`http://127.0.0.1:${port}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    let lastError: any = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000)
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`)
        return payload
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  private async collectMessages(start: number, end: number): Promise<{ messages: any[]; failed: string[]; successful: string[] }> {
    const sessionPayload = await this.api('/api/v1/sessions', { limit: 500 })
    const sessions = (sessionPayload.sessions || []).filter((session: any) => {
      const sessionStart = Number(this.state.cursor.sessionCursors[session.username] || start)
      return Number(session.lastTimestamp || 0) >= sessionStart
    })
    const results = await Promise.allSettled(sessions.map(async (session: any) => {
      const rows: any[] = []
      const sessionStart = Math.max(0, Number(this.state.cursor.sessionCursors[session.username] || start) - 300)
      let offset = 0
      for (let page = 0; page < 50; page += 1) {
        const payload = await this.api('/api/v1/messages', {
          talker: session.username,
          limit: 200,
          offset,
          start: sessionStart,
          end
        })
        const pageRows = Array.isArray(payload.messages) ? payload.messages : []
        rows.push(...pageRows.map((message: any) => ({
          id: String(message.serverId || message.localId),
          sessionId: session.username,
          sessionName: session.displayName || session.username,
          timestamp: Number(message.createTime || 0),
          direction: Number(message.isSend) === 1 ? '我发送' : '对方发送',
          content: String(message.content || message.parsedContent || '').slice(0, 2000)
        })).filter((message: any) => message.content))
        if (!payload.hasMore || pageRows.length < 200) break
        offset += pageRows.length
      }
      return { sessionId: session.username, rows }
    }))
    const messages: any[] = []
    const failed: string[] = []
    const successful: string[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value.sessionId)
        messages.push(...result.value.rows)
      } else {
        failed.push(sessions[index]?.username)
      }
    })
    const deduped = new Map(messages.map(message => [messageKey(message), message]))
    return { messages: [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp), failed, successful }
  }

  private async callAi(messages: any[]): Promise<any> {
    const apiKey = String(this.config.get('aiAssistantApiKey') || '').trim()
    if (!apiKey) throw new Error('请先设置 DeepSeek API Key')
    const baseUrl = String(this.config.get('aiAssistantApiBaseUrl') || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = String(this.config.get('aiAssistantApiModel') || 'deepseek-v4-flash')
    const compact = messages.map(message => ({
      time: new Date(message.timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      session: message.sessionName,
      direction: message.direction,
      content: redact(message.content)
    }))
    let lastError: any = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 3200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + (attempt ? '\n务必输出单个完整 JSON 对象。' : '') },
            { role: 'user', content: `请输出 json。新增消息：${JSON.stringify(compact)}` }
          ]
        }),
        signal: AbortSignal.timeout(90_000)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek 请求失败 (${response.status})`)
      try {
        return parseModelJson(payload?.choices?.[0]?.message?.content)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  async sync(): Promise<any> {
    if (this.activeSync) return this.activeSync
    this.activeSync = this.runSync()
    try {
      return await this.activeSync
    } finally {
      this.activeSync = null
    }
  }

  private async runSync(): Promise<any> {
    this.state.cursor.lastAttemptAt = new Date().toISOString()
    this.saveState()
    const now = Math.floor(Date.now() / 1000)
    const lookbackDays = Number(this.config.get('aiAssistantInitialLookbackDays')) || 3
    const start = this.state.cursor.lastMessageTimestamp
      ? Math.max(0, this.state.cursor.lastMessageTimestamp - 300)
      : now - lookbackDays * 86_400
    try {
      const collected = await this.collectMessages(start, now)
      const seen = new Set(this.state.cursor.recentMessageIds)
      const fresh = collected.messages.filter(message => !seen.has(messageKey(message)))
      const digests: any[] = []
      for (let offset = 0; offset < fresh.length; offset += 400) {
        digests.push(await this.callAi(fresh.slice(offset, offset + 400)))
      }
      const tasks = new Map<string, AssistantTask>()
      const highlights: string[] = []
      const summaries: string[] = []
      for (const digest of digests) {
        highlights.push(...(Array.isArray(digest.highlights) ? digest.highlights : []))
        if (digest.summary) summaries.push(String(digest.summary))
        for (const item of Array.isArray(digest.tasks) ? digest.tasks : []) {
          const task: AssistantTask = {
            id: stableTaskId(item),
            title: String(item.title || '待确认事项').slice(0, 160),
            detail: String(item.detail || '').slice(0, 500),
            owner: String(item.owner || '我').slice(0, 50),
            due: String(item.due || '').slice(0, 40),
            priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
            source: String(item.source || '').slice(0, 100),
            confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
            status: 'todo'
          }
          tasks.set(task.id, task)
        }
      }
      const existing = new Map(this.state.tasks.map(task => [task.id, task]))
      const createdAt = new Date().toISOString()
      for (const task of tasks.values()) {
        const previous = existing.get(task.id)
        existing.set(task.id, previous ? { ...task, status: previous.status, createdAt: previous.createdAt, updatedAt: createdAt } : { ...task, createdAt, updatedAt: createdAt })
      }
      const today = shanghaiDate()
      if (fresh.length > 0) {
        this.state.briefings[today] = {
          date: today,
          headline: `已整理 ${fresh.length} 条新增消息`,
          summary: summaries.join(' ').slice(0, 900),
          highlights: [...new Set(highlights)].slice(0, 8),
          tasks: [...tasks.values()],
          messageCount: fresh.length,
          failedSessions: collected.failed.length,
          generatedAt: createdAt
        }
      }
      this.state.tasks = [...existing.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      this.state.cursor.recentMessageIds = [...new Set([...this.state.cursor.recentMessageIds, ...collected.messages.map(messageKey)])].slice(-20_000)
      for (const sessionId of collected.successful) this.state.cursor.sessionCursors[sessionId] = now
      this.state.cursor.lastMessageTimestamp = now
      this.state.cursor.lastSuccessfulRunAt = createdAt
      this.state.cursor.lastError = null
      this.state.lastSyncAt = createdAt
      this.saveState()
      if (tasks.size > 0) {
        await showSystemNotification({
          title: `AI 助理发现 ${tasks.size} 个新待办`,
          content: [...tasks.values()].slice(0, 2).map(task => task.title).join('；'),
          channel: 'ai-assistant',
          targetRoute: '/ai-assistant'
        }).catch(() => undefined)
      }
      return { success: true, newMessageCount: fresh.length, newTaskCount: tasks.size, failedSessions: collected.failed.length }
    } catch (error: any) {
      this.state.cursor.lastError = error?.message || String(error)
      this.saveState()
      throw error
    }
  }

  getStatus(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      syncing: Boolean(this.activeSync),
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      model: this.config.get('aiAssistantApiModel'),
      cursor: this.state.cursor
    }
  }

  getDashboard(): any {
    const dates = Object.keys(this.state.briefings).sort().reverse()
    const latest = dates[0] ? this.state.briefings[dates[0]] : null
    return { briefing: latest ? { ...latest, tasks: this.state.tasks } : null, tasks: this.state.tasks, cursor: this.state.cursor }
  }

  getSettings(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      baseUrl: this.config.get('aiAssistantApiBaseUrl'),
      model: this.config.get('aiAssistantApiModel'),
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      enabled: this.config.get('aiAssistantEnabled')
    }
  }

  setSettings(input: any): any {
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) this.config.set('aiAssistantApiKey', input.apiKey.trim())
    if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) this.config.set('aiAssistantApiBaseUrl', input.baseUrl.trim())
    if (typeof input.model === 'string' && input.model.trim()) this.config.set('aiAssistantApiModel', input.model.trim())
    if (/^\d{2}:\d{2}$/.test(input.scheduleTime || '')) this.config.set('aiAssistantScheduleTime', input.scheduleTime)
    if (typeof input.enabled === 'boolean') this.config.set('aiAssistantEnabled', input.enabled)
    return this.getSettings()
  }

  updateTask(id: string, patch: any): AssistantTask | null {
    const task = this.state.tasks.find(item => item.id === id)
    if (!task) return null
    if (['todo', 'doing', 'done'].includes(patch.status)) task.status = patch.status
    task.updatedAt = new Date().toISOString()
    this.saveState()
    return task
  }

  private async schedulerTick(): Promise<void> {
    if (!this.config.get('aiAssistantEnabled') || this.activeSync) return
    const now = new Date()
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const today = shanghaiDate()
    const schedule = String(this.config.get('aiAssistantScheduleTime') || '20:00')
    if (time < schedule || this.state.cursor.lastScheduledRunDate === today) return
    if (Date.now() - this.lastSchedulerAttemptAt < 15 * 60_000) return
    this.lastSchedulerAttemptAt = Date.now()
    try {
      await this.sync()
      this.state.cursor.lastScheduledRunDate = today
      this.saveState()
    } catch {}
  }
}

export const aiAssistantService = new AiAssistantService()
