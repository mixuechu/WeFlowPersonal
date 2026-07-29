import { app } from 'electron'
import crypto from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { ConfigService } from './config'
import { httpService } from './httpService'
import { showSystemNotification } from './systemNotificationService'
import { personalMemoryStore } from './personalMemoryStore'

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
  classification?: 'mine' | 'uncertain'
  assignmentEvidence?: string
  sourceMessageIds?: string[]
}

type GraphEntity = {
  id: string
  type: 'person' | 'organization' | 'group' | 'project'
  canonicalName: string
  aliases: string[]
  accountIds: string[]
  summary: string
  confidence: number
  evidenceMessageIds: string[]
  createdAt: string
  updatedAt: string
  identityVersion: number
  lastDisambiguatedAt: string | null
}

type GraphRelation = {
  id: string
  subjectId: string
  predicate: string
  objectId: string
  confidence: number
  directionExplanation?: string
  evidence: Array<{ messageId: string; sessionId: string; timestamp: number; excerpt: string }>
  status: 'candidate' | 'confirmed' | 'rejected'
  createdAt: string
  updatedAt: string
}

type AssistantState = {
  version: 3
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
  graph: {
    entities: GraphEntity[]
    relations: GraphRelation[]
    reviewQueue: Array<{ id: string; kind: 'possible_duplicate' | 'relation'; title: string; detail: string; confidence: number; status: 'pending' | 'confirmed' | 'rejected'; createdAt: string; leftEntityId?: string; rightEntityId?: string; relationId?: string }>
  }
}

const EMPTY_STATE: AssistantState = {
  version: 3,
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
  },
  graph: { entities: [], relations: [], reviewQueue: [] }
}

const SYSTEM_PROMPT = `你是一个谨慎的中文私人助理兼个人记忆图谱分析器。输入包含按会话组织的连续微信消息和用户身份档案。
待办归属规则：只有明确@用户、称呼用户、上下文明确指派用户，或用户自己明确承诺承担的事项才进入 mine；可能相关但证据不足进入 uncertain；明确分配给他人则标为 others；群公告、@所有人和泛泛讨论不得成为任务。
“我发送”只表示消息方向，绝不表示任务负责人是用户。用户发出的“查一下、看一下、确认一下、问一下、发一下、快、请、麻烦、帮我”等祈使句或请求，默认是要求收件人/群友执行，必须标为 others；只有同时出现“我来、我会、我负责、我去、我处理、我跟进、我要”等明确自我承诺，才可能标为 mine。
群聊必须结合 sender、direction、被提及名字和前后文判断，不能因为群内出现祈使句就默认属于用户。每个任务必须给出 assignmentEvidence。
身份映射规则：每个会话的 participants 提供 wxid、通讯录备注 contactRemark、微信昵称 wechatNickname、群昵称 groupNickname、微信号 alias 和 displayName。wxid 是稳定身份主键，其余名称都是该身份在不同场景下的别名；同一个 wxid 的多个名称必须视为同一人，不同 wxid 即使同名也不得自动合并。理解消息中的称呼时优先结合群昵称和通讯录备注。
分片规则：消息的 analysisScope 为 core 时才允许产生待办、实体、关系或合并候选；context 消息仅用于理解 core 的前后文，绝对不能单独据此重复产出结果。
知识图谱规则：提取人物、组织、群和项目，以及有明确消息证据的关系。不要因名字相同就合并人物；一个人可以有多个账号和别名。身份不确定时创建候选，不做硬合并。所有关系必须带 messageId 证据。
“用户”“我”“本人”“对方”“群友”“某人”“未知”等只是角色占位词，绝对不能作为实体名称。用户本人必须使用身份档案里的真实姓名；身份档案没有姓名时，不创建用户本人的人物实体。
只根据消息证据，不臆测；title 用动词开头；不确定日期时 due 为空；source 使用会话显示名。
只返回 JSON：
{"headline":"标题","summary":"摘要","highlights":["重要信息"],"tasks":[{"title":"待办","detail":"上下文","owner":"我","due":"","priority":"high|medium|low","source":"会话名","confidence":0.8,"classification":"mine|uncertain|others","assignmentEvidence":"归属证据","sourceMessageIds":["消息ID"]}],"entities":[{"tempId":"e1","type":"person|organization|group|project","canonicalName":"名称","aliases":[],"accountIds":[],"summary":"仅基于证据的简述","confidence":0.8,"evidenceMessageIds":["消息ID"]}],"relations":[{"subjectTempId":"e1","predicate":"从主语到宾语可直接朗读的有向关系","objectTempId":"e2","directionExplanation":"完整自然语言，例如A向B提供服务","confidence":0.8,"evidenceMessageIds":["消息ID"]}],"possibleDuplicates":[{"leftTempId":"e1","rightExistingName":"已有实体名","confidence":0.7,"reason":"原因"}]}`

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

function isOfficialAccountSession(session: any): boolean {
  const username = String(session?.username || session?.sessionId || '').trim().toLowerCase()
  const type = String(session?.type || '').trim().toLowerCase()
  const sessionType = String(session?.sessionType || '').trim().toLowerCase()
  return username.startsWith('gh_') || type === 'official' || sessionType === 'channel'
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
    personalMemoryStore.initialize(join(app.getPath('userData'), 'personal-memory.sqlite'))
    this.migrateLegacyData()
    this.loadState()
    this.saveState()
    this.scheduler = setInterval(() => void this.schedulerTick(), 60_000)
    this.scheduler.unref()
    if (this.config.get('aiAssistantEnabled')) {
      setTimeout(() => void this.sync().catch(() => undefined), 5_000)
    }
  }

  dispose(): void {
    if (this.scheduler) clearInterval(this.scheduler)
    this.scheduler = null
    personalMemoryStore.close()
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
        version: 3,
        cursor: { ...structuredClone(EMPTY_STATE.cursor), ...(loaded.cursor || {}) },
        tasks: Array.isArray(loaded.tasks)
          ? loaded.tasks.map((task: AssistantTask) => task.classification ? task : { ...task, classification: 'uncertain' })
          : [],
        graph: {
          entities: Array.isArray(loaded.graph?.entities) ? loaded.graph.entities.map((entity: any) => ({
            ...entity, identityVersion: Number(entity.identityVersion || 1), lastDisambiguatedAt: entity.lastDisambiguatedAt || null
          })) : [],
          relations: Array.isArray(loaded.graph?.relations) ? loaded.graph.relations : [],
          reviewQueue: Array.isArray(loaded.graph?.reviewQueue) ? loaded.graph.reviewQueue : []
        }
      }
      this.repairPlaceholderEntities()
      this.repairInvalidRelations()
    } catch {
      this.state = structuredClone(EMPTY_STATE)
    }
  }

  private repairPlaceholderEntities(): void {
    const reserved = new Set(['用户', '我', '本人', '自己', '对方', '群友', '某人', '未知', '未知用户', 'unknown', 'user'])
    const ownerName = String(this.config.get('aiAssistantOwnerName') || '').trim()
    const removed = new Set<string>()
    for (const entity of this.state.graph.entities) {
      if (entity.type !== 'person' || !reserved.has(entity.canonicalName.trim().toLowerCase())) continue
      const aliases = entity.aliases.map(alias => alias.trim())
      const inferredOwnerName = ownerName && aliases.includes(ownerName)
        ? ownerName
        : (entity.accountIds.length > 0 && aliases.length === 1 && !reserved.has(aliases[0].toLowerCase()) ? aliases[0] : '')
      if (inferredOwnerName) {
        entity.canonicalName = inferredOwnerName
        entity.aliases = aliases.filter(alias => alias !== inferredOwnerName && !reserved.has(alias.toLowerCase()))
        entity.summary = entity.summary.replace(/用户自称/g, `${inferredOwnerName}自称`).replace(/^用户/g, inferredOwnerName)
        entity.updatedAt = new Date().toISOString()
      } else {
        removed.add(entity.id)
      }
    }
    if (removed.size) {
      this.state.graph.entities = this.state.graph.entities.filter(entity => !removed.has(entity.id))
      this.state.graph.relations = this.state.graph.relations.filter(relation => !removed.has(relation.subjectId) && !removed.has(relation.objectId))
    }
  }

  private repairInvalidRelations(): void {
    const entityTypes = new Map(this.state.graph.entities.map(entity => [entity.id, entity.type]))
    const personOnlyPredicates = /伴侣|配偶|夫妻|父亲|母亲|兄弟|姐妹|朋友|同学/
    const removed = new Set(this.state.graph.relations.filter(relation =>
      personOnlyPredicates.test(relation.predicate) &&
      (entityTypes.get(relation.subjectId) !== 'person' || entityTypes.get(relation.objectId) !== 'person')
    ).map(relation => relation.id))
    if (!removed.size) return
    this.state.graph.relations = this.state.graph.relations.filter(relation => !removed.has(relation.id))
    this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review => !review.relationId || !removed.has(review.relationId))
  }

  private saveState(): void {
    mkdirSync(dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.statePath)
    try {
      personalMemoryStore.syncGraph(this.state.graph)
    } catch (error) {
      console.error('[AI Assistant] 个人记忆数据库同步失败:', error)
    }
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
    const contactsPayload = await this.api('/api/v1/contacts', { limit: 10_000 }).catch(() => ({ contacts: [] }))
    const contactsById = new Map((contactsPayload.contacts || []).map((contact: any) => [String(contact.username), contact]))
    const policies = personalMemoryStore.getConversationPolicies()
    const allSessions = sessionPayload.sessions || []
    for (const session of allSessions) {
      if (isOfficialAccountSession(session) || policies.get(session.username) === false) {
        // 忽略期间持续推进该会话游标，重新启用时默认从启用时刻开始，
        // 避免突然补分析数月历史消息。
        this.state.cursor.sessionCursors[session.username] = end
      }
    }
    const sessions = allSessions.filter((session: any) => {
      if (isOfficialAccountSession(session)) return false
      if (policies.get(session.username) === false) return false
      const sessionStart = Number(this.state.cursor.sessionCursors[session.username] || start)
      return Number(session.lastTimestamp || 0) >= sessionStart
    })
    const results = await Promise.allSettled(sessions.map(async (session: any) => {
      const rawRows: any[] = []
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
        rawRows.push(...pageRows)
        if (!payload.hasMore || pageRows.length < 200) break
        offset += pageRows.length
      }
      const isGroup = String(session.username).endsWith('@chatroom')
      const membersPayload = isGroup && rawRows.length
        ? await this.api('/api/v1/group-members', { chatroomId: session.username }).catch(() => ({ members: [] }))
        : { members: [] }
      const membersById = new Map((membersPayload.members || []).map((member: any) => [String(member.wxid), member]))
      const rows = rawRows.map((message: any) => {
        const isSelf = Number(message.isSend) === 1
        const senderId = String(message.senderUsername || (isSelf ? 'self' : ''))
        const contact: any = contactsById.get(senderId) || {}
        const member: any = membersById.get(senderId) || {}
        const identity = {
          wxid: senderId,
          contactRemark: String(member.remark || contact.remark || ''),
          wechatNickname: String(member.nickname || contact.nickname || contact.nickName || ''),
          groupNickname: String(member.groupNickname || ''),
          alias: String(member.alias || contact.alias || ''),
          displayName: String(
            member.groupNickname || member.remark || contact.remark ||
            member.nickname || contact.nickname || contact.nickName ||
            member.displayName || contact.displayName ||
            message.senderDisplayName || message.senderName || message.displayName || senderId
          )
        }
        return {
          id: String(message.serverId || message.localId),
          sessionId: session.username,
          sessionName: session.displayName || session.username,
          timestamp: Number(message.createTime || 0),
          direction: isSelf ? '我发送' : '对方发送',
          senderId,
          senderName: isSelf ? '我' : identity.displayName,
          senderIdentity: identity,
          isGroup,
          content: String(message.content || message.parsedContent || '').slice(0, 2000)
        }
      }).filter((message: any) => message.content)
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
      messageId: message.id,
      time: new Date(message.timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      session: message.sessionName,
      sessionId: message.sessionId,
      isGroup: message.isGroup,
      direction: message.direction,
      senderId: message.senderId,
      sender: message.direction === '我发送' ? '我' : (message.senderName || message.senderId || '未知发送者'),
      analysisScope: message.analysisScope || 'core',
      senderIdentity: message.senderIdentity,
      content: redact(message.content)
    }))
    const conversations = Object.values(compact.reduce((groups: Record<string, any>, message: any) => {
      const key = message.sessionId
      if (!groups[key]) groups[key] = { session: message.session, sessionId: key, isGroup: message.isGroup, participants: {}, messages: [] }
      if (message.senderIdentity?.wxid) groups[key].participants[message.senderIdentity.wxid] = message.senderIdentity
      const { senderIdentity, ...compactMessage } = message
      groups[key].messages.push(compactMessage)
      return groups
    }, {})).map((conversation: any) => ({ ...conversation, participants: Object.values(conversation.participants) }))
    const configuredOwnerName = String(this.config.get('aiAssistantOwnerName') || '').trim()
    const configuredAliases = String(this.config.get('aiAssistantOwnerAliases') || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean)
    const selfIdentity = messages.find(message => message.direction === '我发送' && message.senderIdentity)?.senderIdentity
    const inferredOwnerName = String(
      selfIdentity?.contactRemark || selfIdentity?.wechatNickname || selfIdentity?.displayName || ''
    ).trim()
    const ownerProfile = {
      name: configuredOwnerName || inferredOwnerName,
      aliases: [...new Set([
        ...configuredAliases,
        selfIdentity?.contactRemark,
        selfIdentity?.wechatNickname,
        selfIdentity?.groupNickname,
        selfIdentity?.alias
      ].map(value => String(value || '').trim()).filter(Boolean))],
      wxid: String(selfIdentity?.wxid || ''),
      background: String(this.config.get('aiAssistantOwnerBackground') || '').trim()
    }
    const existingGraph = this.state.graph.entities.slice(-200).map(entity => ({
      id: entity.id,
      type: entity.type,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      accountIds: entity.accountIds,
      summary: entity.summary
    }))
    let lastError: any = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 5000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + (attempt ? '\n务必输出单个完整 JSON 对象。' : '') },
            { role: 'user', content: `用户身份档案：${JSON.stringify(ownerProfile)}
现有知识图谱实体（用于关联，不得仅凭同名合并）：${JSON.stringify(existingGraph)}
按会话组织的新增消息：${JSON.stringify(conversations)}
请输出 json。` }
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

  private buildAnalysisBatches(messages: any[]): any[][] {
    const bySession = new Map<string, any[]>()
    for (const message of messages) {
      const rows = bySession.get(message.sessionId) || []
      rows.push(message)
      bySession.set(message.sessionId, rows)
    }
    const windows: any[][] = []
    for (const rows of bySession.values()) {
      rows.sort((a, b) => a.timestamp - b.timestamp)
      if (rows.length <= 260) {
        windows.push(rows.map(message => ({ ...message, analysisScope: 'core' })))
        continue
      }
      for (let coreStart = 0; coreStart < rows.length; coreStart += 200) {
        const coreEnd = Math.min(rows.length, coreStart + 200)
        const windowStart = Math.max(0, coreStart - 30)
        const windowEnd = Math.min(rows.length, coreEnd + 30)
        windows.push(rows.slice(windowStart, windowEnd).map((message, index) => ({
          ...message,
          analysisScope: windowStart + index >= coreStart && windowStart + index < coreEnd ? 'core' : 'context'
        })))
      }
    }
    const batches: any[][] = []
    let pending: any[] = []
    for (const window of windows) {
      if (pending.length && pending.length + window.length > 400) {
        batches.push(pending)
        pending = []
      }
      pending.push(...window)
    }
    if (pending.length) batches.push(pending)
    return batches
  }

  private mergeGraphDigest(digest: any, sourceMessages: any[], now: string): void {
    const tempIds = new Map<string, string>()
    const entities = Array.isArray(digest.entities) ? digest.entities : []
    for (const item of entities) {
      const reservedNames = new Set(['用户', '我', '本人', '自己', '对方', '群友', '某人', '未知', '未知用户', 'unknown', 'user'])
      const ownerName = String(this.config.get('aiAssistantOwnerName') || '').trim()
      const rawName = String(item.canonicalName || '').trim()
      const itemAliases = (Array.isArray(item.aliases) ? item.aliases : []).map(String).filter(Boolean)
      const canonicalName = reservedNames.has(rawName.toLowerCase()) && ownerName && itemAliases.includes(ownerName)
        ? ownerName
        : rawName
      if (!canonicalName || reservedNames.has(canonicalName.toLowerCase())) continue
      const accountIds = [...new Set((Array.isArray(item.accountIds) ? item.accountIds : []).map(String).filter(Boolean))]
      const aliases = [...new Set(itemAliases.filter(alias => !reservedNames.has(alias.trim().toLowerCase()) && alias !== canonicalName))]
      const byAccount = accountIds.length
        ? this.state.graph.entities.find(entity => entity.accountIds.some(id => accountIds.includes(id)))
        : undefined
      const exactNameMatches = this.state.graph.entities.filter(entity =>
        entity.type === item.type && entity.canonicalName === canonicalName)
      const existing = byAccount || (exactNameMatches.length === 1 && Number(item.confidence || 0) >= 0.9 ? exactNameMatches[0] : undefined)
      const id = existing?.id || `ent_${crypto.randomUUID()}`
      tempIds.set(String(item.tempId || id), id)
      const evidenceIds = [...new Set((Array.isArray(item.evidenceMessageIds) ? item.evidenceMessageIds : []).map(String))]
      if (existing) {
        const before = JSON.stringify([existing.canonicalName, existing.aliases, existing.accountIds, existing.summary])
        existing.aliases = [...new Set([...existing.aliases, ...aliases])]
        existing.accountIds = [...new Set([...existing.accountIds, ...accountIds])]
        existing.summary = String(item.summary || existing.summary).slice(0, 800)
        existing.confidence = Math.max(existing.confidence, Number(item.confidence || 0))
        existing.evidenceMessageIds = [...new Set([...existing.evidenceMessageIds, ...evidenceIds])].slice(-500)
        existing.updatedAt = now
        if (before !== JSON.stringify([existing.canonicalName, existing.aliases, existing.accountIds, existing.summary])) existing.identityVersion += 1
        this.enqueueIdentityCandidates(existing, now)
      } else {
        const created: GraphEntity = {
          id,
          type: ['person', 'organization', 'group', 'project'].includes(item.type) ? item.type : 'person',
          canonicalName: canonicalName.slice(0, 100),
          aliases,
          accountIds,
          summary: String(item.summary || '').slice(0, 800),
          confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
          evidenceMessageIds: evidenceIds,
          createdAt: now,
          updatedAt: now,
          identityVersion: 1,
          lastDisambiguatedAt: null
        }
        this.state.graph.entities.push(created)
        this.enqueueIdentityCandidates(created, now)
      }
    }
    for (const item of Array.isArray(digest.relations) ? digest.relations : []) {
      const subjectId = tempIds.get(String(item.subjectTempId || ''))
      const objectId = tempIds.get(String(item.objectTempId || ''))
      if (!subjectId || !objectId || subjectId === objectId) continue
      const predicate = String(item.predicate || '').trim().slice(0, 80)
      if (!predicate) continue
      const subjectType = this.state.graph.entities.find(entity => entity.id === subjectId)?.type
      const objectType = this.state.graph.entities.find(entity => entity.id === objectId)?.type
      if (/伴侣|配偶|夫妻|父亲|母亲|兄弟|姐妹|朋友|同学/.test(predicate) &&
          (subjectType !== 'person' || objectType !== 'person')) continue
      const id = crypto.createHash('sha256').update(`${subjectId}|${predicate}|${objectId}`).digest('hex').slice(0, 20)
      const evidenceIds = (Array.isArray(item.evidenceMessageIds) ? item.evidenceMessageIds : []).map(String)
      const evidence = sourceMessages.filter(message => evidenceIds.includes(String(message.id))).map(message => ({
        messageId: String(message.id),
        sessionId: String(message.sessionId),
        timestamp: Number(message.timestamp),
        excerpt: redact(String(message.content)).slice(0, 160)
      }))
      const existing = this.state.graph.relations.find(relation => relation.id === id)
      if (existing) {
        const known = new Set(existing.evidence.map(item => item.messageId))
        existing.evidence.push(...evidence.filter(item => !known.has(item.messageId)))
        existing.confidence = Math.max(existing.confidence, Number(item.confidence || 0))
        existing.updatedAt = now
      } else {
        const relation: GraphRelation = {
          id, subjectId, predicate, objectId,
          confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
          directionExplanation: String(item.directionExplanation || '').slice(0, 240),
          evidence,
          status: Number(item.confidence || 0) >= 0.9 ? 'confirmed' : 'candidate',
          createdAt: now,
          updatedAt: now
        }
        this.state.graph.relations.push(relation)
        if (relation.status === 'candidate') {
          const subject = this.state.graph.entities.find(entity => entity.id === subjectId)?.canonicalName || '未知'
          const object = this.state.graph.entities.find(entity => entity.id === objectId)?.canonicalName || '未知'
          this.state.graph.reviewQueue.push({
            id: `review_rel_${id}`, kind: 'relation', title: `${subject} — ${predicate} → ${object}`,
            detail: String(item.directionExplanation || evidence[0]?.excerpt || '需要根据消息证据确认这条关系').slice(0, 300),
            confidence: relation.confidence, status: 'pending', createdAt: now, relationId: id
          })
        }
      }
    }
    for (const item of Array.isArray(digest.possibleDuplicates) ? digest.possibleDuplicates : []) {
      const leftId = tempIds.get(String(item.leftTempId || ''))
      if (!leftId) continue
      const right = this.state.graph.entities.find(entity => entity.canonicalName === String(item.rightExistingName || ''))
      if (!right || right.id === leftId) continue
      const id = crypto.createHash('sha256').update(`${leftId}|${right.id}`).digest('hex').slice(0, 20)
      if (this.state.graph.reviewQueue.some(review => review.id === id)) continue
      const leftName = this.state.graph.entities.find(entity => entity.id === leftId)?.canonicalName || '未知人物'
      this.state.graph.reviewQueue.push({
        id,
        kind: 'possible_duplicate',
        title: `${leftName} ↔ ${right.canonicalName}`,
        detail: String(item.reason || ''),
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.5))),
        status: 'pending',
        createdAt: now,
        leftEntityId: leftId,
        rightEntityId: right.id
      })
    }
  }

  private enqueueIdentityCandidates(entity: GraphEntity, now: string): void {
    if (entity.type !== 'person') return
    const names = new Set([entity.canonicalName, ...entity.aliases].map(value => value.trim().toLowerCase()).filter(value => value.length >= 2))
    for (const candidate of this.state.graph.entities) {
      if (candidate.id === entity.id || candidate.type !== 'person') continue
      const candidateNames = [candidate.canonicalName, ...candidate.aliases].map(value => value.trim().toLowerCase())
      const shared = candidateNames.find(name => names.has(name))
      if (!shared) continue
      const decision = personalMemoryStore.getIdentityDecision(entity.id, candidate.id)
      const orderedVersions = entity.id <= candidate.id
        ? [entity.identityVersion, candidate.identityVersion]
        : [candidate.identityVersion, entity.identityVersion]
      if (decision?.decision === 'different' &&
          Number(decision.left_version) === orderedVersions[0] &&
          Number(decision.right_version) === orderedVersions[1]) continue
      const [leftId, rightId] = [entity.id, candidate.id].sort()
      const id = crypto.createHash('sha256').update(`${leftId}|${rightId}`).digest('hex').slice(0, 20)
      if (this.state.graph.reviewQueue.some(review => review.id === id && review.status === 'pending')) continue
      this.state.graph.reviewQueue.push({
        id, kind: 'possible_duplicate', title: `${entity.canonicalName} ↔ ${candidate.canonicalName}`,
        detail: `共享名称或别名“${shared}”，账号不同，需确认是否为同一人。`,
        confidence: 0.65, status: 'pending', createdAt: now,
        leftEntityId: entity.id, rightEntityId: candidate.id
      })
    }
    entity.lastDisambiguatedAt = now
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
      const createdAt = new Date().toISOString()
      for (const batch of this.buildAnalysisBatches(fresh)) {
        const digest = await this.callAi(batch)
        digests.push(digest)
        this.mergeGraphDigest(digest, batch, createdAt)
      }
      const tasks = new Map<string, AssistantTask>()
      const highlights: string[] = []
      const summaries: string[] = []
      for (const digest of digests) {
        highlights.push(...(Array.isArray(digest.highlights) ? digest.highlights : []))
        if (digest.summary) summaries.push(String(digest.summary))
        for (const item of Array.isArray(digest.tasks) ? digest.tasks : []) {
          const sourceMessageIds = Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds.map(String).slice(0, 20) : []
          const evidenceMessages = fresh.filter(message => sourceMessageIds.includes(String(message.id)))
          const evidenceText = evidenceMessages.map(message => String(message.content || '')).join('\n')
          const onlySentByUser = evidenceMessages.length > 0 && evidenceMessages.every(message => message.direction === '我发送')
          const isRequest = /请|麻烦|帮我|帮忙|查一下|看一下|确认一下|问一下|发一下|给我|快/.test(evidenceText)
          const isSelfCommitment = /我(?:来|会|负责|去|处理|跟进|完成|安排|准备|需要|要)/.test(evidenceText)
          let classification: 'mine' | 'uncertain' | 'others' =
            item.classification === 'mine' || item.classification === 'others' ? item.classification : 'uncertain'
          if (onlySentByUser && isRequest && !isSelfCommitment) classification = 'others'
          if (classification === 'others') continue
          const task: AssistantTask = {
            id: stableTaskId(item),
            title: String(item.title || '待确认事项').slice(0, 160),
            detail: String(item.detail || '').slice(0, 500),
            owner: String(item.owner || '我').slice(0, 50),
            due: String(item.due || '').slice(0, 40),
            priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
            source: String(item.source || '').slice(0, 100),
            confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
            status: 'todo',
            classification,
            assignmentEvidence: String(item.assignmentEvidence || '').slice(0, 300),
            sourceMessageIds
          }
          tasks.set(task.id, task)
        }
      }
      const existing = new Map(this.state.tasks.map(task => [task.id, task]))
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
          tasks: [...tasks.values()].filter(task => task.classification === 'mine'),
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
      const mineTasks = [...tasks.values()].filter(task => task.classification === 'mine')
      if (mineTasks.length > 0) {
        await showSystemNotification({
          title: `AI 助理发现 ${mineTasks.length} 个新待办`,
          content: mineTasks.slice(0, 2).map(task => task.title).join('；'),
          channel: 'ai-assistant',
          targetRoute: '/ai-assistant'
        }).catch(() => undefined)
      }
      return { success: true, newMessageCount: fresh.length, newTaskCount: mineTasks.length, failedSessions: collected.failed.length }
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
    const tasks = this.state.tasks.filter(task => task.classification === 'mine')
    const taskReviewQueue = this.state.tasks.filter(task => task.classification !== 'mine')
    return {
      briefing: latest ? { ...latest, tasks } : null,
      tasks,
      taskReviewQueue,
      cursor: this.state.cursor,
      graph: this.state.graph,
      mergeHistory: personalMemoryStore.listActiveMerges()
    }
  }

  getSettings(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      baseUrl: this.config.get('aiAssistantApiBaseUrl'),
      model: this.config.get('aiAssistantApiModel'),
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      enabled: this.config.get('aiAssistantEnabled'),
      ownerName: this.config.get('aiAssistantOwnerName'),
      ownerAliases: this.config.get('aiAssistantOwnerAliases'),
      ownerBackground: this.config.get('aiAssistantOwnerBackground')
    }
  }

  async getConversationSources(): Promise<any[]> {
    const sessionPayload = await this.api('/api/v1/sessions', { limit: 500 })
    const policies = personalMemoryStore.getConversationPolicies()
    return (sessionPayload.sessions || []).filter((session: any) => !isOfficialAccountSession(session)).map((session: any) => ({
      sessionId: String(session.username),
      displayName: String(session.displayName || session.username),
      type: String(session.username).endsWith('@chatroom') ? 'group' : 'private',
      enabled: policies.get(session.username) !== false,
      lastTimestamp: Number(session.lastTimestamp || 0)
    })).sort((a: any, b: any) => b.lastTimestamp - a.lastTimestamp)
  }

  setConversationSource(input: { sessionId: string; displayName?: string; type?: 'group' | 'private'; enabled: boolean }): any {
    const sessionId = String(input.sessionId || '').trim()
    if (!sessionId) throw new Error('缺少会话 ID')
    if (sessionId.toLowerCase().startsWith('gh_')) {
      personalMemoryStore.setConversationPolicy(sessionId, String(input.displayName || sessionId), 'private', false)
      return { success: true, sessionId, enabled: false, excludedReason: 'official_account' }
    }
    const type = input.type === 'group' || sessionId.endsWith('@chatroom') ? 'group' : 'private'
    personalMemoryStore.setConversationPolicy(sessionId, String(input.displayName || sessionId), type, Boolean(input.enabled))
    this.state.cursor.sessionCursors[sessionId] = Math.floor(Date.now() / 1000)
    this.saveState()
    return { success: true, sessionId, enabled: Boolean(input.enabled) }
  }

  setConversationSourcesBulk(input: { type: 'group' | 'private'; enabled: boolean; sources: any[] }): any {
    const now = Math.floor(Date.now() / 1000)
    let updated = 0
    for (const source of input.sources || []) {
      const sessionId = String(source.sessionId || '').trim()
      const type = sessionId.endsWith('@chatroom') ? 'group' : 'private'
      if (!sessionId || type !== input.type) continue
      personalMemoryStore.setConversationPolicy(sessionId, String(source.displayName || sessionId), type, Boolean(input.enabled))
      this.state.cursor.sessionCursors[sessionId] = now
      updated += 1
    }
    this.saveState()
    return { success: true, updated }
  }

  setSettings(input: any): any {
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) this.config.set('aiAssistantApiKey', input.apiKey.trim())
    if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) this.config.set('aiAssistantApiBaseUrl', input.baseUrl.trim())
    if (typeof input.model === 'string' && input.model.trim()) this.config.set('aiAssistantApiModel', input.model.trim())
    if (/^\d{2}:\d{2}$/.test(input.scheduleTime || '')) this.config.set('aiAssistantScheduleTime', input.scheduleTime)
    if (typeof input.enabled === 'boolean') this.config.set('aiAssistantEnabled', input.enabled)
    if (typeof input.ownerName === 'string') this.config.set('aiAssistantOwnerName', input.ownerName.trim())
    if (typeof input.ownerAliases === 'string') this.config.set('aiAssistantOwnerAliases', input.ownerAliases.trim())
    if (typeof input.ownerBackground === 'string') this.config.set('aiAssistantOwnerBackground', input.ownerBackground.trim())
    this.repairPlaceholderEntities()
    this.saveState()
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

  updateTaskReview(id: string, decision: 'mine' | 'rejected'): AssistantTask | null {
    const index = this.state.tasks.findIndex(item => item.id === id && item.classification !== 'mine')
    if (index < 0) return null
    const task = this.state.tasks[index]
    if (decision === 'rejected') {
      this.state.tasks.splice(index, 1)
      this.saveState()
      return task
    }
    task.classification = 'mine'
    task.updatedAt = new Date().toISOString()
    this.saveState()
    return task
  }

  updateGraphReview(id: string, decision: 'confirmed' | 'rejected'): any {
    const review = this.state.graph.reviewQueue.find(item => item.id === id)
    if (!review || review.status !== 'pending') return null
    review.status = decision
    if (review.kind === 'relation' && review.relationId) {
      const relation = this.state.graph.relations.find(item => item.id === review.relationId)
      if (relation) {
        relation.status = decision
        relation.updatedAt = new Date().toISOString()
      }
    }
    if (review.kind === 'possible_duplicate' && decision === 'confirmed' && review.leftEntityId && review.rightEntityId) {
      const source = this.state.graph.entities.find(entity => entity.id === review.leftEntityId)
      const target = this.state.graph.entities.find(entity => entity.id === review.rightEntityId)
      if (source && target) {
        personalMemoryStore.recordMerge(source.id, target.id, {
          source: structuredClone(source),
          target: structuredClone(target),
          relations: structuredClone(this.state.graph.relations)
        })
        target.aliases = [...new Set([...target.aliases, source.canonicalName, ...source.aliases])].filter(alias => alias !== target.canonicalName)
        target.accountIds = [...new Set([...target.accountIds, ...source.accountIds])]
        target.evidenceMessageIds = [...new Set([...target.evidenceMessageIds, ...source.evidenceMessageIds])]
        target.summary = target.summary || source.summary
        target.confidence = Math.max(target.confidence, source.confidence)
        target.updatedAt = new Date().toISOString()
        target.identityVersion += 1
        target.lastDisambiguatedAt = target.updatedAt
        for (const relation of this.state.graph.relations) {
          if (relation.subjectId === source.id) relation.subjectId = target.id
          if (relation.objectId === source.id) relation.objectId = target.id
        }
        const normalizedRelations = new Map<string, GraphRelation>()
        for (const relation of this.state.graph.relations) {
          if (relation.subjectId === relation.objectId) continue
          const relationId = crypto.createHash('sha256')
            .update(`${relation.subjectId}|${relation.predicate}|${relation.objectId}`).digest('hex').slice(0, 20)
          const existingRelation = normalizedRelations.get(relationId)
          if (existingRelation) {
            const knownEvidence = new Set(existingRelation.evidence.map(item => item.messageId))
            existingRelation.evidence.push(...relation.evidence.filter(item => !knownEvidence.has(item.messageId)))
            existingRelation.confidence = Math.max(existingRelation.confidence, relation.confidence)
          } else {
            normalizedRelations.set(relationId, { ...relation, id: relationId })
          }
        }
        this.state.graph.relations = [...normalizedRelations.values()]
        this.state.graph.entities = this.state.graph.entities.filter(entity => entity.id !== source.id)
        personalMemoryStore.recordIdentityDecision(source.id, target.id, 'merged', source.identityVersion, target.identityVersion, review.detail)
      }
    }
    if (review.kind === 'possible_duplicate' && decision === 'rejected' && review.leftEntityId && review.rightEntityId) {
      const left = this.state.graph.entities.find(entity => entity.id === review.leftEntityId)
      const right = this.state.graph.entities.find(entity => entity.id === review.rightEntityId)
      if (left && right) personalMemoryStore.recordIdentityDecision(left.id, right.id, 'different', left.identityVersion, right.identityVersion, review.detail)
    }
    this.saveState()
    return review
  }

  revertMerge(id: number): any {
    const snapshot = personalMemoryStore.getMergeSnapshot(id)
    if (!snapshot?.source || !snapshot?.target || !Array.isArray(snapshot.relations)) return null
    this.state.graph.entities = this.state.graph.entities.filter(entity => entity.id !== snapshot.source.id && entity.id !== snapshot.target.id)
    this.state.graph.entities.push(snapshot.source, snapshot.target)
    this.state.graph.relations = snapshot.relations
    personalMemoryStore.markMergeReverted(id)
    this.saveState()
    return { success: true }
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
