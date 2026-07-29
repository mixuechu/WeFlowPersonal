import { app } from 'electron'
import crypto from 'crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { jsonrepair } from 'jsonrepair'
import JSZip from 'jszip'
import { ConfigService } from './config'
import { httpService } from './httpService'
import { showSystemNotification } from './systemNotificationService'
import { personalMemoryStore } from './personalMemoryStore'
import { localEmbeddingService } from './localEmbeddingService'
import { extractAttachmentText } from './attachmentTextExtractor'
import { structureOcrText } from './imageOcrStructuring'
import { captureWebSnapshot } from './webSnapshotService'
import { extractScannedPdfText, getPdfOcrStatus } from './pdfOcrService'
import { exportService } from './export'
import { filterMemorySearchResults, type MemorySearchOptions } from './memorySearchFilters'
import { buildMemoryQueryPlan } from './memoryQueryPlanner'
import {
  applyReminderPreferences,
  buildTaskReminders,
  findMatchingTask,
  normalizeReminderPreferences,
  type ReminderPreferences,
  type TaskReminder
} from './taskIntelligence'
import { buildEntityInsights } from './relationshipInsights'
import { classifyTaskAssignment, evaluateTaskAssignmentPolicy } from './taskAssignmentPolicy'
import { buildWeeklyBriefing, isQuietTime } from './briefingIntelligence'
import {
  enqueueUniqueNotification,
  markNotificationAttempt,
  type NotificationOutbox
} from './notificationOutbox'
import { findCommonGraphNeighbors } from './graphCommonNeighbors'
import { buildProjectInsights } from './projectInsights'
import { summarizeIngestionRuns } from './ingestionDiagnostics'
import { attachLocalImageOcr, attachLocalVoiceTranscript, recoverMessageSemantics } from './messageSemanticRecovery'
import { sanitizeDiagnosticText } from './diagnosticRedaction'
import { chatService } from './chatService'
import { voiceTranscribeService } from './voiceTranscribeService'
import { localOcrService } from './localOcrService'
import {
  assessIdentityPair,
  buildGraphIdentitySuggestions,
  buildNameBuckets,
  getFullIdentityScanSchedule,
  identityPairKey,
  isNegativeDecisionCurrent
} from './identityDisambiguation'

type AssistantTask = {
  id: string
  title: string
  detail: string
  owner: string
  due: string
  priority: 'high' | 'medium' | 'low'
  source: string
  sourceSessionId?: string
  collaborators?: string[]
  project?: string
  dependsOnIds?: string[]
  taskKind?: 'action' | 'delegated' | 'waiting'
  confidence: number
  status: 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled'
  createdAt?: string
  updatedAt?: string
  classification?: 'mine' | 'uncertain'
  assignmentEvidence?: string
  ownershipPolicyReason?: string
  sourceMessageIds?: string[]
  evidence?: Array<{ messageId: string; timestamp: number; sender: string; excerpt: string }>
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
  notifications: NotificationOutbox
  reminderPreferences: ReminderPreferences
  cursor: {
    lastMessageTimestamp: number
    recentMessageIds: string[]
    sessionCursors: Record<string, number>
    lastSuccessfulRunAt: string | null
    lastScheduledRunDate: string | null
    lastReminderNotificationDate?: string | null
    lastAttemptAt: string | null
    lastError: string | null
  }
  graph: {
    entities: GraphEntity[]
    relations: GraphRelation[]
    reviewQueue: Array<{ id: string; kind: 'possible_duplicate' | 'relation'; title: string; detail: string; confidence: number; status: 'pending' | 'confirmed' | 'rejected'; createdAt: string; leftEntityId?: string; rightEntityId?: string; relationId?: string; candidateSource?: string; candidateSignals?: Array<{ source: string; label: string; value: string }> }>
    identityScan: { lastFullScanAt: string | null; lastRunAt: string | null; lastMode: 'incremental' | 'full' | null; lastCandidateCount: number }
  }
}

const EMPTY_STATE: AssistantState = {
  version: 3,
  briefings: {},
  tasks: [],
  lastSyncAt: null,
  notifications: { pending: [], sentKeys: [] },
  reminderPreferences: { mutedKinds: [], snoozedUntil: {}, history: [] },
  cursor: {
    lastMessageTimestamp: 0,
    recentMessageIds: [],
    sessionCursors: {},
    lastSuccessfulRunAt: null,
    lastScheduledRunDate: null,
    lastReminderNotificationDate: null,
    lastAttemptAt: null,
    lastError: null
  },
  graph: { entities: [], relations: [], reviewQueue: [], identityScan: { lastFullScanAt: null, lastRunAt: null, lastMode: null, lastCandidateCount: 0 } }
}

const EXTRACTION_PROMPT_VERSION = 'personal-os-prompt-v5'
const EXTRACTION_SCHEMA_VERSION = 'personal-memory-schema-v4'

const SYSTEM_PROMPT = `你是一个谨慎的中文私人助理兼个人记忆图谱分析器。输入包含按会话组织的连续微信消息和用户身份档案。
待办归属规则：只有明确@用户、称呼用户、上下文明确指派用户，或用户自己明确承诺承担的事项才进入 mine；可能相关但证据不足进入 uncertain；明确分配给他人则标为 others；群公告、@所有人和泛泛讨论不得成为任务。
“我发送”只表示消息方向，绝不表示任务负责人是用户。用户发出的“查一下、看一下、确认一下、问一下、发一下、快、请、麻烦、帮我”等祈使句或请求，默认是要求收件人/群友执行，必须标为 others；只有同时出现“我来、我会、我负责、我去、我处理、我跟进、我要”等明确自我承诺，才可能标为 mine。
群聊必须结合 sender、direction、被提及名字和前后文判断，不能因为群内出现祈使句就默认属于用户。每个任务必须给出 assignmentEvidence。
引用消息规则：semanticType=quote 时，content 中“[引用上下文｜发送者：原文]”属于被引用的原作者，不是当前回复者的新陈述；它只能用于理解指代、回复对象和上下文，不得把引用原文的承诺或任务重新归到当前回复者名下。链接、文件、聊天记录、小程序、图片、语音、视频和表情的 semanticType 必须保留其媒介性质。
身份映射规则：每个会话的 participants 提供 wxid、通讯录备注 contactRemark、微信昵称 wechatNickname、群昵称 groupNickname、微信号 alias 和 displayName。wxid 是稳定身份主键，其余名称都是该身份在不同场景下的别名；同一个 wxid 的多个名称必须视为同一人，不同 wxid 即使同名也不得自动合并。理解消息中的称呼时优先结合群昵称和通讯录备注。
分片规则：消息的 analysisScope 为 core 时才允许产生待办、实体、关系或合并候选；context 消息仅用于理解 core 的前后文，绝对不能单独据此重复产出结果。
知识图谱规则：提取人物、组织、群和项目，以及有明确消息证据的关系。不要因名字相同就合并人物；一个人可以有多个账号和别名。身份不确定时创建候选，不做硬合并。所有关系必须带 messageId 证据。
事实记忆规则：必须检查 core 消息中是否包含可长期复用的事实，例如身份、职业、组织、技能、偏好、所在地、项目属性、联系方式和状态变化；有则写入 claims。本人明确陈述标记 self_statement，他人陈述标记 other_statement，仅从上下文推断标记 inference。事实必须带直接 evidenceMessageIds；短暂寒暄和纯情绪不作为事实。明确否定或更正（例如“我不是某公司员工”“我已经不住上海”）也必须抽取，predicate 保持肯定式标准属性名，polarity 标为 negative；不要把“不任职于”另造为一个无法比较的新 predicate。
事件记忆规则：必须检查 core 消息中是否发生或计划会议、承诺、交付、旅行、付款、组织变化、决定等有时间意义的事件；有则写入 events。事件必须带 evidenceMessageIds，参与实体必须引用本次 entities 的 tempId。没有合格内容时数组为空，claims 和 events 两个字段仍必须返回。
输出预算：每批最多 30 个实体、30 条关系、20 条高价值 claims、15 个 events 和 20 个 tasks；优先保留与用户本人、重要人物、项目和行动有关且证据最强的内容，禁止为了凑数量记录琐碎事实。
“用户”“我”“本人”“对方”“群友”“某人”“未知”等只是角色占位词，绝对不能作为实体名称。用户本人必须使用身份档案里的真实姓名；身份档案没有姓名时，不创建用户本人的人物实体。
只根据消息证据，不臆测；title 用动词开头；不确定日期时 due 为空；source 使用会话显示名。
只返回 JSON：
{"headline":"标题","summary":"摘要","highlights":["重要信息"],"tasks":[{"title":"待办","detail":"上下文","owner":"负责人真实名称","collaborators":["协作者"],"project":"所属项目","dependsOnTitles":["依赖待办标题"],"taskKind":"action|delegated|waiting","due":"","priority":"high|medium|low","source":"会话名","confidence":0.8,"classification":"mine|uncertain|others","assignmentEvidence":"归属证据","sourceMessageIds":["消息ID"]}],"entities":[{"tempId":"e1","type":"person|organization|group|project","canonicalName":"名称","aliases":[],"accountIds":[],"summary":"仅基于证据的简述","confidence":0.8,"evidenceMessageIds":["消息ID"]}],"relations":[{"subjectTempId":"e1","predicate":"从主语到宾语可直接朗读的有向关系","objectTempId":"e2","directionExplanation":"完整自然语言，例如A向B提供服务","confidence":0.8,"evidenceMessageIds":["消息ID"]}],"claims":[{"subjectTempId":"e1","predicate":"肯定式标准事实属性","objectTempId":"","objectValue":"事实值","polarity":"positive|negative","valueType":"text|number|date|boolean","validFrom":"","validTo":"","confidence":0.8,"sourceNature":"self_statement|other_statement|inference","evidenceMessageIds":["消息ID"]}],"events":[{"eventType":"meeting|commitment|delivery|travel|payment|organization_change|decision|other","title":"事件","description":"描述","startAt":"","endAt":"","location":"","participants":[{"tempId":"e1","role":"参与者角色"}],"confidence":0.8,"evidenceMessageIds":["消息ID"]}],"possibleDuplicates":[{"leftTempId":"e1","rightExistingName":"已有实体名","confidence":0.7,"reason":"原因"}]}`

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
  const evidence = (Array.isArray(task.sourceMessageIds) ? task.sourceMessageIds : []).map(String).sort().join(',')
  const value = [task.title, task.source, evidence].map(item => String(item || '').trim().toLowerCase()).join('|')
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
    const candidate = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced
    try {
      return JSON.parse(jsonrepair(candidate))
    } catch {
      throw new Error('模型没有返回有效 JSON')
    }
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
  private vectorIndexPromise: Promise<any> | null = null
  private cancelRequested = false

  async initialize(): Promise<void> {
    this.statePath = join(app.getPath('userData'), 'ai-assistant-state.json')
    localEmbeddingService.initialize(app.getPath('userData'))
    localOcrService.initialize(join(app.getPath('userData'), 'ai-ocr-cache.json'))
    personalMemoryStore.initialize(join(app.getPath('userData'), 'personal-memory.sqlite'))
    this.migrateLegacyData()
    this.loadState()
    this.saveState()
    this.scheduler = setInterval(() => void this.schedulerTick(), 60_000)
    this.scheduler.unref()
    if (this.config.get('aiAssistantEnabled')) {
      setTimeout(() => void this.sync().catch(() => undefined), 5_000)
    }
    setTimeout(() => void this.flushNotificationOutbox(new Date()), 8_000)
    setTimeout(() => void this.ensureVectorIndex().catch(error =>
      console.warn('[AI Assistant] 本地向量索引暂未完成:', error)), 12_000)
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
        notifications: {
          pending: Array.isArray(loaded.notifications?.pending) ? loaded.notifications.pending : [],
          sentKeys: Array.isArray(loaded.notifications?.sentKeys) ? loaded.notifications.sentKeys : []
        },
        reminderPreferences: normalizeReminderPreferences(loaded.reminderPreferences),
        tasks: Array.isArray(loaded.tasks)
          ? loaded.tasks.map((task: AssistantTask) => task.classification ? task : { ...task, classification: 'uncertain' })
          : [],
        graph: {
          entities: Array.isArray(loaded.graph?.entities) ? loaded.graph.entities.map((entity: any) => ({
            ...entity, identityVersion: Number(entity.identityVersion || 1), lastDisambiguatedAt: entity.lastDisambiguatedAt || null
          })) : [],
          relations: Array.isArray(loaded.graph?.relations) ? loaded.graph.relations : [],
          reviewQueue: Array.isArray(loaded.graph?.reviewQueue) ? loaded.graph.reviewQueue : [],
          identityScan: {
            ...structuredClone(EMPTY_STATE.graph.identityScan),
            ...(loaded.graph?.identityScan || {})
          }
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
      personalMemoryStore.syncTasks(this.state.tasks)
    } catch (error) {
      console.error('[AI Assistant] 个人记忆数据库同步失败:', sanitizeDiagnosticText(error))
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
    const ocrImages = Boolean(this.config.get('aiAssistantOcrImages'))
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
          end,
          media: ocrImages ? '1' : undefined,
          image: ocrImages ? '1' : undefined,
          voice: ocrImages ? '0' : undefined,
          video: ocrImages ? '0' : undefined,
          emoji: ocrImages ? '0' : undefined
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
        const semantics = recoverMessageSemantics(message)
        return {
          id: String(message.serverId || message.localId),
          localId: String(message.localId || ''),
          serverId: String(message.serverId || ''),
          sessionId: session.username,
          sessionName: session.displayName || session.username,
          timestamp: Number(message.createTime || 0),
          direction: isSelf ? '我发送' : '对方发送',
          senderId,
          senderName: isSelf ? '我' : identity.displayName,
          senderIdentity: identity,
          isGroup,
          content: semantics.content,
          semanticType: semantics.semanticType,
          replyToMessageId: semantics.replyToMessageId,
          quotedSender: semantics.quotedSender,
          mediaLocalPath: String(message.mediaLocalPath || ''),
          appMsgKind: String(message.appMsgKind || ''),
          linkTitle: String(message.linkTitle || ''),
          linkUrl: String(message.linkUrl || ''),
          fileName: String(message.fileName || message.mediaFileName || ''),
          fileExt: String(message.fileExt || ''),
          fileSize: Number(message.fileSize || 0),
          fileMd5: String(message.fileMd5 || '')
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
    const sorted = [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp)
    await this.enrichVoiceTranscripts(sorted)
    await this.enrichImageOcr(sorted)
    await this.enrichAttachmentText(sorted)
    await this.enrichWebSnapshots(sorted)
    return { messages: sorted, failed, successful }
  }

  private async enrichVoiceTranscripts(messages: any[]): Promise<void> {
    if (!this.config.get('autoTranscribeVoice')) return
    const model = await voiceTranscribeService.getModelStatus().catch(() => ({ success: false, exists: false }))
    if (!model.success || !model.exists) return
    const candidates = messages.filter(message =>
      message.semanticType === 'voice' && message.localId && !String(message.content || '').includes('本地转写')
    ).slice(0, 12)
    for (const message of candidates) {
      try {
        const result = await chatService.getVoiceTranscript(
          message.sessionId,
          message.localId,
          message.timestamp,
          undefined,
          message.senderId,
          message.serverId
        )
        if (result.success && result.transcript?.trim()) {
          message.content = attachLocalVoiceTranscript(message.content, redact(result.transcript))
          message.transcriptionSource = 'sensevoice-local'
        }
      } catch {}
    }
  }

  private async enrichImageOcr(messages: any[]): Promise<void> {
    if (!this.config.get('aiAssistantOcrImages')) return
    const status = await localOcrService.getStatus()
    if (!status.available || !status.chinese) return
    const candidates = messages.filter(message =>
      message.semanticType === 'image' && message.mediaLocalPath && !String(message.content || '').includes('本地OCR')
    ).slice(-8)
    for (const message of candidates) {
      const result = await localOcrService.recognize(message.mediaLocalPath)
      if (result.success && result.text?.trim()) {
        message.content = attachLocalImageOcr(message.content, redact(result.text))
        message.ocrSource = 'tesseract-local'
        message.ocrStructure = structureOcrText(redact(result.text))
      }
    }
  }

  private async enrichAttachmentText(messages: any[]): Promise<void> {
    const candidates = messages.filter(message =>
      message.semanticType === 'file' && message.fileName
    ).slice(-6)
    for (const message of candidates) {
      try {
        const located = await exportService.context.resolveFileAttachmentForIndexing({
          fileName: message.fileName,
          fileMd5: message.fileMd5,
          createTime: message.timestamp
        })
        if (!located) {
          message.attachmentIndexStatus = 'not_found'
          continue
        }
        const extracted = await extractAttachmentText(located.sourcePath, located.size)
        message.attachmentLocalPath = located.sourcePath
        message.attachmentMatchedBy = located.matchedBy
        message.attachmentIndexStatus = extracted.status
        message.attachmentFormat = extracted.format
        if (extracted.status === 'ocr_required' && this.config.get('aiAssistantOcrImages')) {
          const scanned = await extractScannedPdfText(located.sourcePath)
          message.attachmentPdfOcrStatus = scanned.status
          message.attachmentPdfOcrPages = scanned.processedPages
          message.attachmentPdfTotalPages = scanned.totalPages
          message.attachmentPdfOcrTruncated = scanned.truncated
          message.attachmentPdfOcrNextPage = scanned.nextPage
          if (scanned.success) {
            message.content = `${message.content}\n[PDF扫描·本地OCR] ${redact(scanned.text)}`.slice(0, 18_000)
            message.attachmentIndexStatus = 'indexed'
            message.attachmentFormat = '.pdf-ocr'
            message.attachmentTextSource = 'poppler-tesseract-local'
          }
        }
        if (extracted.success) {
          message.content = `${message.content}\n[附件·本地正文] ${redact(extracted.text)}`.slice(0, 18_000)
          message.attachmentTextSource = 'local-bounded-parser'
        }
      } catch {
        message.attachmentIndexStatus = 'failed'
      }
    }
  }

  private async enrichWebSnapshots(messages: any[]): Promise<void> {
    if (!this.config.get('aiAssistantIndexWebLinks')) return
    const candidates = messages.filter(message =>
      message.semanticType === 'link' && /^https?:\/\//i.test(message.linkUrl || '')
    ).slice(-4)
    for (const message of candidates) {
      const snapshot = await captureWebSnapshot(message.linkUrl)
      message.webSnapshotStatus = snapshot.status
      message.webSnapshotFinalUrl = snapshot.finalUrl || ''
      message.webSnapshotTitle = snapshot.title || ''
      message.webSnapshotDescription = snapshot.description || ''
      if (snapshot.success && snapshot.text) {
        message.content = `${message.content}\n[网页·本地快照] ${snapshot.text}`.slice(0, 18_000)
        message.webSnapshotSource = 'local-safe-fetch'
      }
    }
  }

  private async continuePendingPdfOcr(): Promise<void> {
    if (!this.config.get('aiAssistantOcrImages')) return
    const pending = personalMemoryStore.listPendingPdfOcrResources(1)
    for (const resource of pending) {
      const filePath = String(resource.metadata?.attachmentLocalPath || '')
      if (!filePath || !existsSync(filePath)) {
        personalMemoryStore.appendResourceContent(resource.id, '', {
          attachmentPdfOcrStatus: 'not_found',
          attachmentPdfOcrTruncated: false
        })
        continue
      }
      const startPage = Math.max(2, Number(resource.metadata?.attachmentPdfOcrNextPage || 2))
      const scanned = await extractScannedPdfText(filePath, startPage)
      const retryable = scanned.status === 'failed' || scanned.status === 'dependency_missing'
      personalMemoryStore.appendResourceContent(
        resource.id,
        scanned.success ? redact(scanned.text) : '',
        {
          attachmentPdfOcrStatus: scanned.status,
          attachmentPdfOcrPages: Number(resource.metadata?.attachmentPdfOcrPages || 0) + scanned.processedPages,
          attachmentPdfTotalPages: scanned.totalPages || resource.metadata?.attachmentPdfTotalPages || 0,
          attachmentPdfOcrTruncated: retryable ? true : scanned.truncated,
          attachmentPdfOcrNextPage: retryable ? startPage : scanned.nextPage
        }
      )
    }
  }

  private persistMessageResources(messages: any[], createdAt: string): void {
    const resourceTypes = new Set(['link', 'file', 'forward', 'miniapp', 'image', 'voice'])
    const resources = messages.flatMap(message => {
      if (!resourceTypes.has(message.semanticType)) return []
      if (message.semanticType === 'image' && !message.ocrSource) return []
      if (message.semanticType === 'voice' && !message.transcriptionSource) return []
      const recoveredContent = String(message.content || '')
        .replace(/^\[(?:图片·本地OCR|语音·本地转写)\]\s*/, '')
        .trim()
      const resourceType = message.semanticType === 'forward'
        ? 'chat-history'
        : message.semanticType === 'miniapp' ? 'mini-program' : message.semanticType
      const title = String(
        message.linkTitle || message.fileName ||
        (message.semanticType === 'image' ? '图片识别内容' :
          message.semanticType === 'voice' ? '语音转写' :
            message.semanticType === 'chat-history' ? '转发的聊天记录' :
              message.semanticType === 'mini-program' ? '小程序' : '消息资源')
      ).trim()
      const messageId = String(message.id || message.localId || '')
      if (!messageId) return []
      return [{
        id: crypto.createHash('sha256').update(`${message.sessionId}:${messageId}:${resourceType}`).digest('hex').slice(0, 32),
        resourceType,
        title,
        url: message.linkUrl,
        fileName: message.fileName,
        fileExt: message.fileExt,
        content: recoveredContent,
        metadata: {
          sessionId: message.sessionId,
          sessionName: message.sessionName,
          senderId: message.senderId,
          senderName: message.senderName,
          appMsgKind: message.appMsgKind,
          fileSize: message.fileSize,
          fileMd5: message.fileMd5,
          mediaLocalPath: message.mediaLocalPath,
          transcriptionSource: message.transcriptionSource || '',
          ocrSource: message.ocrSource || '',
          ocrStructure: message.ocrStructure || null,
          attachmentLocalPath: message.attachmentLocalPath || '',
          attachmentMatchedBy: message.attachmentMatchedBy || '',
          attachmentIndexStatus: message.attachmentIndexStatus || '',
          attachmentFormat: message.attachmentFormat || '',
          attachmentTextSource: message.attachmentTextSource || '',
          attachmentPdfOcrStatus: message.attachmentPdfOcrStatus || '',
          attachmentPdfOcrPages: message.attachmentPdfOcrPages || 0,
          attachmentPdfTotalPages: message.attachmentPdfTotalPages || 0,
          attachmentPdfOcrTruncated: Boolean(message.attachmentPdfOcrTruncated),
          attachmentPdfOcrNextPage: message.attachmentPdfOcrNextPage || 0,
          webSnapshotStatus: message.webSnapshotStatus || '',
          webSnapshotFinalUrl: message.webSnapshotFinalUrl || '',
          webSnapshotTitle: message.webSnapshotTitle || '',
          webSnapshotDescription: message.webSnapshotDescription || '',
          webSnapshotSource: message.webSnapshotSource || ''
        },
        createdAt: new Date(Number(message.timestamp || 0) * 1000).toISOString(),
        updatedAt: createdAt,
        evidence: [{
          messageId,
          sessionId: message.sessionId,
          timestamp: message.timestamp,
          sender: message.senderName,
          excerpt: String(message.content || '').slice(0, 2000)
        }]
      }]
    })
    personalMemoryStore.upsertResources(resources)
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
      semanticType: message.semanticType,
      transcriptionSource: message.transcriptionSource || undefined,
      ocrSource: message.ocrSource || undefined,
      replyToMessageId: message.replyToMessageId || undefined,
      quotedSender: message.quotedSender || undefined,
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
      const startedAt = Date.now()
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
        return {
          ...parseModelJson(payload?.choices?.[0]?.message?.content),
          __meta: {
            model,
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION,
            inputTokens: Number(payload?.usage?.prompt_tokens || 0),
            outputTokens: Number(payload?.usage?.completion_tokens || 0),
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1
          }
        }
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
      if (rows.length <= 140) {
        windows.push(rows.map(message => ({ ...message, analysisScope: 'core' })))
        continue
      }
      for (let coreStart = 0; coreStart < rows.length; coreStart += 100) {
        const coreEnd = Math.min(rows.length, coreStart + 100)
        const windowStart = Math.max(0, coreStart - 20)
        const windowEnd = Math.min(rows.length, coreEnd + 20)
        windows.push(rows.slice(windowStart, windowEnd).map((message, index) => ({
          ...message,
          analysisScope: windowStart + index >= coreStart && windowStart + index < coreEnd ? 'core' : 'context'
        })))
      }
    }
    const batches: any[][] = []
    let pending: any[] = []
    for (const window of windows) {
      if (pending.length && pending.length + window.length > 160) {
        batches.push(pending)
        pending = []
      }
      pending.push(...window)
    }
    if (pending.length) batches.push(pending)
    return batches
  }

  private mergeGraphDigest(digest: any, sourceMessages: any[], now: string): Map<string, string> {
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
          status: 'candidate',
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
      const leftName = this.state.graph.entities.find(entity => entity.id === leftId)?.canonicalName || '未知人物'
      const left = this.state.graph.entities.find(entity => entity.id === leftId)
      if (left) this.enqueueIdentityPair(left, right, now, {
        source: 'llm_suggestion',
        detail: String(item.reason || ''),
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.5)))
      })
    }
    return tempIds
  }

  private persistClaimsAndEvents(digest: any, tempIds: Map<string, string>, sourceMessages: any[], now: string): void {
    const evidenceFor = (ids: any[], role: 'direct' | 'indirect' | 'contradiction' = 'direct') => {
      const wanted = new Set((Array.isArray(ids) ? ids : []).map(String))
      return sourceMessages.filter(message => wanted.has(String(message.id))).map(message => ({
        messageId: String(message.id),
        sessionId: String(message.sessionId),
        timestamp: Number(message.timestamp),
        excerpt: redact(String(message.content)).slice(0, 300),
        role
      }))
    }
    const claims = (Array.isArray(digest.claims) ? digest.claims : []).flatMap((item: any) => {
      const subjectId = tempIds.get(String(item.subjectTempId || ''))
      const objectEntityId = tempIds.get(String(item.objectTempId || ''))
      const predicate = String(item.predicate || '').trim().slice(0, 100)
      const objectValue = String(item.objectValue || '').trim().slice(0, 1000)
      const polarity = item.polarity === 'negative' ? 'negative' : 'positive'
      const sourceNature = ['self_statement', 'other_statement', 'inference'].includes(item.sourceNature) ? item.sourceNature : 'inference'
      const evidence = evidenceFor(item.evidenceMessageIds, sourceNature === 'self_statement' ? 'direct' : 'indirect')
      if (!subjectId || !predicate || (!objectEntityId && !objectValue) || !evidence.length) return []
      const value = objectEntityId || objectValue
      const subjectName = this.state.graph.entities.find(entity => entity.id === subjectId)?.canonicalName || ''
      const objectName = objectEntityId ? this.state.graph.entities.find(entity => entity.id === objectEntityId)?.canonicalName || '' : objectValue
      const id = crypto.createHash('sha256').update(`${subjectId}|${predicate}|${value}|${polarity}|${String(item.validFrom || '')}`).digest('hex').slice(0, 24)
      return [{
        id, subjectId, predicate, objectEntityId, objectValue: objectEntityId ? '' : objectValue,
        polarity,
        valueType: ['text', 'number', 'date', 'boolean'].includes(item.valueType) ? item.valueType : 'text',
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
        status: 'candidate',
        sourceNature,
        validFrom: String(item.validFrom || ''), validTo: String(item.validTo || ''),
        searchText: `${subjectName} ${polarity === 'negative' ? '并非' : ''} ${predicate} ${objectName}`.trim(), evidence, createdAt: now
      }]
    })
    const events = (Array.isArray(digest.events) ? digest.events : []).flatMap((item: any) => {
      const title = String(item.title || '').trim().slice(0, 200)
      const evidence = evidenceFor(item.evidenceMessageIds)
      if (!title || !evidence.length) return []
      const participants = (Array.isArray(item.participants) ? item.participants : []).flatMap((participant: any) => {
        const entityId = tempIds.get(String(participant.tempId || ''))
        return entityId ? [{ entityId, role: String(participant.role || 'participant').slice(0, 80) }] : []
      })
      const participantNames = participants.map((participant: any) =>
        this.state.graph.entities.find(entity => entity.id === participant.entityId)?.canonicalName || '').filter(Boolean)
      const id = crypto.createHash('sha256').update(`${String(item.eventType || 'other')}|${title}|${String(item.startAt || '')}|${evidence[0].messageId}`).digest('hex').slice(0, 24)
      return [{
        id, eventType: String(item.eventType || 'other').slice(0, 80), title,
        description: String(item.description || '').slice(0, 1200),
        startAt: String(item.startAt || ''), endAt: String(item.endAt || ''), location: String(item.location || '').slice(0, 200),
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
        status: 'candidate', searchText: `${title} ${String(item.description || '')} ${participantNames.join(' ')}`.trim(),
        participants, evidence, createdAt: now
      }]
    })
    personalMemoryStore.upsertClaims(claims)
    personalMemoryStore.upsertEvents(events)
  }

  private enqueueIdentityCandidates(entity: GraphEntity, now: string): void {
    if (entity.type !== 'person') return
    if (this.state.graph.identityScan.lastRunAt !== now) this.state.graph.identityScan.lastCandidateCount = 0
    for (const candidate of this.state.graph.entities) {
      if (this.enqueueIdentityPair(entity, candidate, now)) this.state.graph.identityScan.lastCandidateCount += 1
    }
    entity.lastDisambiguatedAt = now
    this.state.graph.identityScan.lastRunAt = now
    this.state.graph.identityScan.lastMode = 'incremental'
  }

  private enqueueIdentityPair(
    left: GraphEntity,
    right: GraphEntity,
    now: string,
    suggestion?: { source: string; detail: string; confidence: number; label?: string; value?: string }
  ): boolean {
    const assessment = assessIdentityPair(left, right)
    if (!assessment.eligible && (!suggestion || suggestion.confidence < 0.65)) return false
    const decision = personalMemoryStore.getIdentityDecision(left.id, right.id)
    if (isNegativeDecisionCurrent(decision, left, right)) return false
    const id = crypto.createHash('sha256').update(identityPairKey(left.id, right.id)).digest('hex').slice(0, 20)
    const existing = this.state.graph.reviewQueue.find(review => review.id === id)
    if (existing?.status === 'pending') return false
    const signals = assessment.signals.map(signal => ({ source: signal.source, label: signal.label, value: signal.value }))
    if (suggestion?.label && !signals.some(signal => signal.source === suggestion.source)) {
      signals.push({ source: suggestion.source as any, label: suggestion.label, value: suggestion.value || '' })
    }
    const candidateReview = {
      id,
      kind: 'possible_duplicate',
      title: `${left.canonicalName} ↔ ${right.canonicalName}`,
      detail: suggestion?.detail || signals.map(signal => `${signal.label}“${signal.value}”`).join('；') + '，需人工确认是否为同一人。',
      confidence: Math.max(assessment.confidence, suggestion?.confidence || 0),
      status: 'pending',
      createdAt: now,
      leftEntityId: left.id,
      rightEntityId: right.id,
      candidateSource: suggestion?.source || signals[0]?.source || 'rule',
      candidateSignals: signals
    } as const
    if (existing) Object.assign(existing, candidateReview)
    else this.state.graph.reviewQueue.push(candidateReview)
    return true
  }

  private runScheduledIdentityScan(now: string): void {
    const schedule = getFullIdentityScanSchedule(
      this.state.graph.entities.length,
      this.state.graph.identityScan.lastFullScanAt,
      new Date(now)
    )
    if (!schedule.due) return
    const people = this.state.graph.entities.filter(entity => entity.type === 'person')
    const byId = new Map(people.map(entity => [entity.id, entity]))
    const pairKeys = new Set<string>()
    for (const ids of buildNameBuckets(people).values()) {
      for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
          pairKeys.add(identityPairKey(ids[leftIndex], ids[rightIndex]))
        }
      }
    }
    let candidates = 0
    for (const pairKey of pairKeys) {
      const [leftId, rightId] = pairKey.split('|')
      const left = byId.get(leftId)
      const right = byId.get(rightId)
      if (left && right && this.enqueueIdentityPair(left, right, now)) candidates += 1
    }
    this.state.graph.identityScan = {
      lastFullScanAt: now,
      lastRunAt: now,
      lastMode: 'full',
      lastCandidateCount: (this.state.graph.identityScan.lastRunAt === now
        ? this.state.graph.identityScan.lastCandidateCount
        : 0) + candidates
    }
  }

  private runContextualIdentityScan(now: string): void {
    const people = this.state.graph.entities.filter(entity => entity.type === 'person')
    const byId = new Map(people.map(entity => [entity.id, entity]))
    const suggestions = buildGraphIdentitySuggestions(people, this.state.graph.relations)
    for (const pair of personalMemoryStore.listSimilarEntityPairs(localEmbeddingService.modelVersion, 0.88, 200)) {
      if (!byId.has(pair.leftId) || !byId.has(pair.rightId)) continue
      suggestions.push({
        leftId: pair.leftId,
        rightId: pair.rightId,
        source: 'vector_similarity',
        label: '档案语义相似',
        value: `${Math.round(pair.score * 100)}%`,
        detail: `两个人物档案的本地向量相似度为 ${Math.round(pair.score * 100)}%，可能是同一人的不同账号，需人工确认。`,
        confidence: Math.min(0.92, pair.score)
      })
    }
    let candidates = 0
    for (const suggestion of suggestions) {
      const left = byId.get(suggestion.leftId)
      const right = byId.get(suggestion.rightId)
      if (left && right && this.enqueueIdentityPair(left, right, now, suggestion)) candidates += 1
    }
    this.state.graph.identityScan.lastCandidateCount += candidates
  }

  async sync(): Promise<any> {
    if (this.activeSync) return this.activeSync
    this.cancelRequested = false
    this.activeSync = this.runSync()
    try {
      return await this.activeSync
    } finally {
      this.activeSync = null
      this.cancelRequested = false
    }
  }

  private async runSync(): Promise<any> {
    const runId = `run_${crypto.randomUUID()}`
    let runFinished = false
    let cancelled = false
    this.state.cursor.lastAttemptAt = new Date().toISOString()
    this.saveState()
    personalMemoryStore.startIngestionRun(
      runId,
      String(this.config.get('aiAssistantApiModel') || ''),
      `${EXTRACTION_PROMPT_VERSION}/${EXTRACTION_SCHEMA_VERSION}`
    )
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
      await this.continuePendingPdfOcr()
      this.persistMessageResources(fresh, createdAt)
      const successfulMessageKeys: string[] = []
      const batchErrors: string[] = []
      const batches = this.buildAnalysisBatches(fresh)
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        if (this.cancelRequested) {
          cancelled = true
          batchErrors.push('用户已安全暂停，未开始的批次将在下次继续')
          break
        }
        const batch = batches[batchIndex]
        const batchStartedAt = Date.now()
        personalMemoryStore.recordIngestionBatch(runId, batchIndex, batch.length, 'running', '', {
          model: String(this.config.get('aiAssistantApiModel') || ''),
          promptVersion: EXTRACTION_PROMPT_VERSION,
          schemaVersion: EXTRACTION_SCHEMA_VERSION
        })
        try {
          const digest = await this.callAi(batch)
          digests.push(digest)
          const tempIds = this.mergeGraphDigest(digest, batch, createdAt)
          personalMemoryStore.syncGraph(this.state.graph)
          this.persistClaimsAndEvents(digest, tempIds, batch, createdAt)
          const checkpointKeys = batch.filter(message => message.analysisScope === 'core').map(messageKey)
          successfulMessageKeys.push(...checkpointKeys)
          this.state.cursor.recentMessageIds = [...new Set([...this.state.cursor.recentMessageIds, ...checkpointKeys])].slice(-20_000)
          this.saveState()
          personalMemoryStore.recordIngestionBatch(runId, batchIndex, batch.length, 'completed', '', {
            ...digest.__meta,
            durationMs: Number(digest.__meta?.durationMs || Date.now() - batchStartedAt)
          })
          if (this.cancelRequested) {
            cancelled = true
            batchErrors.push('用户已安全暂停，剩余批次将在下次继续')
            break
          }
        } catch (error: any) {
          const message = sanitizeDiagnosticText(error)
          batchErrors.push(message)
          personalMemoryStore.recordIngestionBatch(runId, batchIndex, batch.length, 'failed', message, {
            model: String(this.config.get('aiAssistantApiModel') || ''),
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION,
            durationMs: Date.now() - batchStartedAt
          })
        }
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
          const assignment = classifyTaskAssignment({
            evidenceMessages,
            modelClassification: item.classification,
            modelTaskKind: item.taskKind
          })
          if (!assignment.keep) continue
          const taskKind = assignment.taskKind
          const task: AssistantTask = {
            id: stableTaskId(item),
            title: String(item.title || '待确认事项').slice(0, 160),
            detail: String(item.detail || '').slice(0, 500),
            owner: String(item.owner || '我').slice(0, 50),
            collaborators: (Array.isArray(item.collaborators) ? item.collaborators : [])
              .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20),
            project: String(item.project || '').trim().slice(0, 160),
            dependsOnIds: [],
            taskKind,
            due: String(item.due || '').slice(0, 40),
            priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
            source: String(item.source || '').slice(0, 100),
            sourceSessionId: String(evidenceMessages[0]?.sessionId || ''),
            confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
            status: taskKind === 'waiting' ? 'waiting' : 'todo',
            classification: assignment.classification,
            assignmentEvidence: String(item.assignmentEvidence || '').slice(0, 300),
            ownershipPolicyReason: assignment.rationale,
            sourceMessageIds,
            evidence: evidenceMessages.map(message => ({
              messageId: String(message.id),
              timestamp: Number(message.timestamp),
              sender: message.direction === '我发送' ? '我' : String(message.senderName || message.senderId || '对方'),
              excerpt: redact(String(message.content)).slice(0, 300)
            }))
          }
          ;(task as any).dependsOnTitles = (Array.isArray(item.dependsOnTitles) ? item.dependsOnTitles : [])
            .map((value: any) => String(value || '').trim()).filter(Boolean).slice(0, 20)
          tasks.set(task.id, task)
        }
      }
      const titleToId = new Map([...tasks.values()].map(task => [task.title.trim().toLowerCase(), task.id]))
      for (const task of tasks.values()) {
        task.dependsOnIds = ((task as any).dependsOnTitles || [])
          .map((title: string) => titleToId.get(title.toLowerCase())).filter(Boolean)
        delete (task as any).dependsOnTitles
      }
      const existing = new Map(this.state.tasks.map(task => [task.id, task]))
      for (const task of tasks.values()) {
        const previous = existing.get(task.id) || findMatchingTask(task, this.state.tasks)
        if (previous && previous.id !== task.id) existing.delete(previous.id)
        if (previous) task.id = previous.id
        const mergedTask: AssistantTask = previous ? {
          ...task,
          status: previous.status,
          owner: previous.owner || task.owner,
          collaborators: previous.collaborators || task.collaborators,
          project: previous.project || task.project,
          dependsOnIds: previous.dependsOnIds || task.dependsOnIds,
          taskKind: previous.taskKind || task.taskKind,
          createdAt: previous.createdAt,
          updatedAt: createdAt
        } : { ...task, createdAt, updatedAt: createdAt }
        existing.set(task.id, mergedTask)
        personalMemoryStore.recordTaskChanges(task.id, previous || {}, mergedTask,
          previous ? 'incremental_message_update' : 'created_from_message', task.evidence || [])
      }
      const today = shanghaiDate()
      this.runContextualIdentityScan(createdAt)
      this.runScheduledIdentityScan(createdAt)
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
      this.state.cursor.recentMessageIds = [...new Set([...this.state.cursor.recentMessageIds, ...successfulMessageKeys])].slice(-20_000)
      if (!batchErrors.length) {
        for (const sessionId of collected.successful) this.state.cursor.sessionCursors[sessionId] = now
        this.state.cursor.lastMessageTimestamp = now
        this.state.cursor.lastSuccessfulRunAt = createdAt
        this.state.cursor.lastError = null
        this.state.lastSyncAt = createdAt
      } else {
        this.state.cursor.lastError = `仍有 ${batchErrors.length} 个消息批次等待重试：${batchErrors[0]}`
      }
      this.saveState()
      personalMemoryStore.finishIngestionRun(runId, {
        status: batchErrors.length ? 'partial' : 'completed',
        messageCount: successfulMessageKeys.length,
        entityCount: this.state.graph.entities.length,
        relationCount: this.state.graph.relations.length,
        error: batchErrors[0]
      })
      runFinished = true
      const mineTasks = [...tasks.values()].filter(task => task.classification === 'mine')
      if (mineTasks.length > 0) {
        this.enqueueNotification({
          key: `new-tasks:${mineTasks.map(task => task.id).sort().join(',')}`,
          title: `AI 助理发现 ${mineTasks.length} 个新待办`,
          content: mineTasks.slice(0, 2).map(task => task.title).join('；'),
          createdAt: new Date().toISOString()
        })
        this.saveState()
        await this.flushNotificationOutbox(new Date())
      }
      if (batchErrors.length && !cancelled) throw new Error(this.state.cursor.lastError || '部分消息批次等待重试')
      return {
        success: !batchErrors.length,
        cancelled,
        newMessageCount: successfulMessageKeys.length,
        newTaskCount: mineTasks.length,
        failedSessions: collected.failed.length,
        message: cancelled ? '已安全暂停，成功批次已保存；下次将从断点继续' : ''
      }
    } catch (error: any) {
      this.state.cursor.lastError = sanitizeDiagnosticText(error)
      this.saveState()
      if (!runFinished) {
        personalMemoryStore.finishIngestionRun(runId, {
          status: 'failed', messageCount: 0,
          entityCount: this.state.graph.entities.length,
          relationCount: this.state.graph.relations.length,
          error: this.state.cursor.lastError
        })
      }
      throw error
    }
  }

  getStatus(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      syncing: Boolean(this.activeSync),
      cancelling: this.cancelRequested,
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      model: this.config.get('aiAssistantApiModel'),
      cursor: this.state.cursor
    }
  }

  cancelSync(): any {
    if (!this.activeSync) return { success: false, message: '当前没有正在运行的增量处理' }
    this.cancelRequested = true
    return { success: true, message: '将在当前批次安全完成后暂停' }
  }

  getDashboard(): any {
    const dates = Object.keys(this.state.briefings).sort().reverse()
    const latest = dates[0] ? this.state.briefings[dates[0]] : null
    const tasks = this.state.tasks.filter(task => task.classification === 'mine')
    const taskReviewQueue = this.state.tasks.filter(task => task.classification !== 'mine')
    const allTaskReminders = buildTaskReminders(tasks)
    const reminderResult = applyReminderPreferences(allTaskReminders, this.state.reminderPreferences)
    const taskHistory = personalMemoryStore.listTaskHistory(tasks.map(task => task.id))
    const memoryFeed = personalMemoryStore.getMemoryFeed()
    const entityInsights = buildEntityInsights({
      entities: this.state.graph.entities,
      relations: this.state.graph.relations,
      claims: memoryFeed.claims,
      events: memoryFeed.events,
      tasks
    })
    const projectInsights = buildProjectInsights({
      entities: this.state.graph.entities,
      relations: this.state.graph.relations,
      claims: memoryFeed.claims,
      events: memoryFeed.events,
      tasks
    })
    return {
      briefing: latest ? { ...latest, tasks } : null,
      tasks,
      taskReviewQueue,
      taskReminders: reminderResult.visible,
      reminderPreferences: {
        ...this.state.reminderPreferences,
        suppressed: reminderResult.suppressed,
        total: allTaskReminders.length
      },
      taskHistory,
      entityInsights,
      projectInsights,
      cursor: this.state.cursor,
      graph: this.state.graph,
      relationHistory: personalMemoryStore.listRelationHistory('', 300),
      identityDisambiguation: {
        ...this.state.graph.identityScan,
        ...getFullIdentityScanSchedule(
          this.state.graph.entities.length,
          this.state.graph.identityScan.lastFullScanAt
        )
      },
      mergeHistory: personalMemoryStore.listActiveMerges(),
      memoryStats: personalMemoryStore.getMemoryStats(),
      memoryFeed,
      ingestionStatus: personalMemoryStore.getIngestionStatus(),
      assistantHistory: personalMemoryStore.getRecentAssistantExchanges(),
      qualityBaseline: evaluateTaskAssignmentPolicy(),
      weeklyBriefing: buildWeeklyBriefing(this.state.briefings, tasks),
      notificationDelivery: {
        pending: this.state.notifications.pending.length,
        sent: this.state.notifications.sentKeys.length,
        quiet: this.isNotificationQuiet(new Date()),
        quietStart: this.config.get('aiAssistantQuietStart'),
        quietEnd: this.config.get('aiAssistantQuietEnd'),
        oldestPendingAt: this.state.notifications.pending[0]?.createdAt || null,
        lastError: this.state.notifications.pending.find(item => item.lastError)?.lastError || null
      }
    }
  }

  async getMemoryDiagnostics(): Promise<any> {
    const ingestionRuns = personalMemoryStore.listIngestionRuns(20)
    const ocr = await localOcrService.getStatus()
    const pdfOcr = await getPdfOcrStatus()
    return {
      ...personalMemoryStore.getDiagnostics(),
      ingestionRuns,
      ingestionSummary: summarizeIngestionRuns(ingestionRuns, {
        inputPerMillion: Number(this.config.get('aiAssistantInputCostPerMillion') || 0),
        outputPerMillion: Number(this.config.get('aiAssistantOutputCostPerMillion') || 0)
      }),
      embeddings: {
        ...personalMemoryStore.getEmbeddingStats(localEmbeddingService.modelVersion),
        ...localEmbeddingService.getStatus(),
        indexing: Boolean(this.vectorIndexPromise)
      },
      privacy: {
        ...personalMemoryStore.getFilePermissionAudit(),
        stateMode: (() => { try { return (statSync(this.statePath).mode & 0o777).toString(8).padStart(3, '0') } catch { return null } })(),
        apiKeyStorage: 'macOS Safe Storage',
        httpBinding: '127.0.0.1',
        logsRedacted: true
      },
      ocr: { ...ocr, enabled: Boolean(this.config.get('aiAssistantOcrImages')) },
      pdfOcr: { ...pdfOcr, enabled: Boolean(this.config.get('aiAssistantOcrImages')) }
    }
  }

  createMemoryBackup(): any {
    const result = personalMemoryStore.createBackup()
    const stateBackupPath = `${result.path}.state.json`
    if (existsSync(this.statePath)) {
      copyFileSync(this.statePath, stateBackupPath)
      try { chmodSync(stateBackupPath, 0o600) } catch {}
    }
    return { ...result, stateBackupPath }
  }

  restoreMemoryBackup(path: string): any {
    const stateBackupPath = `${path}.state.json`
    if (!existsSync(stateBackupPath)) throw new Error('该快照缺少 AI 助理状态文件，无法完整恢复')
    JSON.parse(readFileSync(stateBackupPath, 'utf8'))
    const safety = this.createMemoryBackup()
    try {
      const result = personalMemoryStore.restoreBackup(path)
      const temporary = `${this.statePath}.restore-${Date.now()}.tmp`
      copyFileSync(stateBackupPath, temporary)
      renameSync(temporary, this.statePath)
      this.loadState()
      this.saveState()
      return { ...result, safetyBackup: safety.path, restoredStateFrom: stateBackupPath }
    } catch (error) {
      try {
        personalMemoryStore.restoreBackup(safety.path)
        if (safety.stateBackupPath && existsSync(safety.stateBackupPath)) copyFileSync(safety.stateBackupPath, this.statePath)
        this.loadState()
        this.saveState()
      } catch {}
      throw error
    }
  }

  async exportMemoryBundle(outputPath: string): Promise<any> {
    if (!String(outputPath || '').trim()) throw new Error('未选择导出位置')
    const backup = this.createMemoryBackup()
    const databaseBytes = readFileSync(backup.path)
    const stateBytes = readFileSync(backup.stateBackupPath)
    const manifest = {
      format: 'weflow-personal-memory',
      version: 1,
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      databaseSha256: crypto.createHash('sha256').update(databaseBytes).digest('hex'),
      stateSha256: crypto.createHash('sha256').update(stateBytes).digest('hex')
    }
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    zip.file('personal-memory.sqlite', databaseBytes)
    zip.file('ai-assistant-state.json', stateBytes)
    const payload = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    writeFileSync(outputPath, payload, { mode: 0o600 })
    try { chmodSync(outputPath, 0o600) } catch {}
    return { success: true, path: outputPath, bytes: payload.length, manifest }
  }

  async inspectMemoryBundle(bundlePath: string): Promise<any> {
    const zip = await JSZip.loadAsync(readFileSync(bundlePath))
    const manifestEntry = zip.file('manifest.json')
    const databaseEntry = zip.file('personal-memory.sqlite')
    const stateEntry = zip.file('ai-assistant-state.json')
    if (!manifestEntry || !databaseEntry || !stateEntry) throw new Error('迁移包不完整')
    const manifest = JSON.parse(await manifestEntry.async('string'))
    if (manifest?.format !== 'weflow-personal-memory' || manifest?.version !== 1) throw new Error('不支持的迁移包格式')
    const databaseBytes = await databaseEntry.async('nodebuffer')
    const stateBytes = await stateEntry.async('nodebuffer')
    const databaseSha256 = crypto.createHash('sha256').update(databaseBytes).digest('hex')
    const stateSha256 = crypto.createHash('sha256').update(stateBytes).digest('hex')
    if (databaseSha256 !== manifest.databaseSha256 || stateSha256 !== manifest.stateSha256) {
      throw new Error('迁移包校验失败，文件可能损坏')
    }
    const state = JSON.parse(stateBytes.toString('utf8'))
    return {
      valid: true,
      manifest,
      databaseBytes: databaseBytes.length,
      stateSummary: {
        version: state.version,
        tasks: Array.isArray(state.tasks) ? state.tasks.length : 0,
        entities: Array.isArray(state.graph?.entities) ? state.graph.entities.length : 0,
        relations: Array.isArray(state.graph?.relations) ? state.graph.relations.length : 0,
        lastSyncAt: state.lastSyncAt || null
      }
    }
  }

  async importMemoryBundle(bundlePath: string): Promise<any> {
    await this.inspectMemoryBundle(bundlePath)
    const zip = await JSZip.loadAsync(readFileSync(bundlePath))
    const databaseBytes = await zip.file('personal-memory.sqlite')!.async('uint8array')
    const stateText = await zip.file('ai-assistant-state.json')!.async('string')
    const imported = personalMemoryStore.registerImportedBackup(databaseBytes, stateText)
    return { ...this.restoreMemoryBackup(imported.path), importedFrom: bundlePath }
  }

  getSettings(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      baseUrl: this.config.get('aiAssistantApiBaseUrl'),
      model: this.config.get('aiAssistantApiModel'),
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      quietStart: this.config.get('aiAssistantQuietStart'),
      quietEnd: this.config.get('aiAssistantQuietEnd'),
      inputCostPerMillion: this.config.get('aiAssistantInputCostPerMillion'),
      outputCostPerMillion: this.config.get('aiAssistantOutputCostPerMillion'),
      enabled: this.config.get('aiAssistantEnabled'),
      ownerName: this.config.get('aiAssistantOwnerName'),
      ownerAliases: this.config.get('aiAssistantOwnerAliases'),
      ownerBackground: this.config.get('aiAssistantOwnerBackground'),
      transcribeVoice: this.config.get('autoTranscribeVoice'),
      ocrImages: this.config.get('aiAssistantOcrImages'),
      indexWebLinks: this.config.get('aiAssistantIndexWebLinks')
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
    if (/^\d{2}:\d{2}$/.test(input.quietStart || '')) this.config.set('aiAssistantQuietStart', input.quietStart)
    if (/^\d{2}:\d{2}$/.test(input.quietEnd || '')) this.config.set('aiAssistantQuietEnd', input.quietEnd)
    if (Number.isFinite(Number(input.inputCostPerMillion)) && Number(input.inputCostPerMillion) >= 0) {
      this.config.set('aiAssistantInputCostPerMillion', Number(input.inputCostPerMillion))
    }
    if (Number.isFinite(Number(input.outputCostPerMillion)) && Number(input.outputCostPerMillion) >= 0) {
      this.config.set('aiAssistantOutputCostPerMillion', Number(input.outputCostPerMillion))
    }
    if (typeof input.enabled === 'boolean') this.config.set('aiAssistantEnabled', input.enabled)
    if (typeof input.ownerName === 'string') this.config.set('aiAssistantOwnerName', input.ownerName.trim())
    if (typeof input.ownerAliases === 'string') this.config.set('aiAssistantOwnerAliases', input.ownerAliases.trim())
    if (typeof input.ownerBackground === 'string') this.config.set('aiAssistantOwnerBackground', input.ownerBackground.trim())
    if (typeof input.transcribeVoice === 'boolean') this.config.set('autoTranscribeVoice', input.transcribeVoice)
    if (typeof input.ocrImages === 'boolean') this.config.set('aiAssistantOcrImages', input.ocrImages)
    if (typeof input.indexWebLinks === 'boolean') this.config.set('aiAssistantIndexWebLinks', input.indexWebLinks)
    this.repairPlaceholderEntities()
    this.saveState()
    return this.getSettings()
  }

  updateTask(id: string, patch: any): AssistantTask | null {
    const task = this.state.tasks.find(item => item.id === id)
    if (!task) return null
    const before = structuredClone(task)
    if (['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(patch.status)) task.status = patch.status
    if (typeof patch.title === 'string' && patch.title.trim()) task.title = patch.title.trim().slice(0, 300)
    if (typeof patch.detail === 'string') task.detail = patch.detail.trim().slice(0, 2000)
    if (typeof patch.owner === 'string') task.owner = patch.owner.trim().slice(0, 100) || '我'
    if (Array.isArray(patch.collaborators)) task.collaborators = patch.collaborators
      .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    if (typeof patch.project === 'string') task.project = patch.project.trim().slice(0, 160)
    if (Array.isArray(patch.dependsOnIds)) {
      const knownIds = new Set(this.state.tasks.map(item => item.id))
      task.dependsOnIds = [...new Set(patch.dependsOnIds.map(String).filter((value: string) => value !== id && knownIds.has(value)))].slice(0, 30)
    }
    if (['action', 'delegated', 'waiting'].includes(patch.taskKind)) task.taskKind = patch.taskKind
    if (typeof patch.due === 'string') task.due = patch.due.trim().slice(0, 100)
    if (['high', 'medium', 'low'].includes(patch.priority)) task.priority = patch.priority
    task.updatedAt = new Date().toISOString()
    personalMemoryStore.recordTaskChanges(id, before, task, String(patch.reason || 'manual_edit'), task.evidence || [])
    this.saveState()
    return task
  }

  createTaskFromMemory(input: any): AssistantTask {
    const title = String(input?.title || '').trim().slice(0, 300)
    if (!title) throw new Error('待办标题不能为空')
    const citations = Array.isArray(input?.citations) ? input.citations.slice(0, 20) : []
    const evidence = citations.flatMap((citation: any) => Array.isArray(citation?.evidence)
      ? citation.evidence.map((item: any) => ({
        messageId: String(item.message_id || item.messageId || ''),
        timestamp: Number(item.timestamp || 0),
        sender: String(item.sender || ''),
        excerpt: String(item.excerpt || '').slice(0, 2000)
      })).filter((item: any) => item.messageId)
      : []).slice(0, 30)
    const firstEvidence = citations.flatMap((citation: any) => citation?.evidence || [])[0]
    const now = new Date().toISOString()
    const task: AssistantTask = {
      id: `task_${crypto.randomUUID()}`,
      title,
      detail: String(input?.detail || '').trim().slice(0, 2000),
      owner: '我',
      collaborators: [],
      project: '',
      dependsOnIds: [],
      taskKind: 'action',
      due: '',
      priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'medium',
      source: '个人记忆问答',
      sourceSessionId: String(firstEvidence?.session_id || firstEvidence?.sessionId || ''),
      confidence: citations.length ? 0.9 : 0.6,
      status: 'todo',
      classification: 'mine',
      assignmentEvidence: citations.length ? `由 ${citations.length} 条记忆引用生成` : '由个人记忆问答手动生成',
      evidence,
      createdAt: now,
      updatedAt: now
    }
    this.state.tasks.unshift(task)
    personalMemoryStore.recordTaskChanges(task.id, {}, task, 'created_from_memory', evidence)
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

  updateReminderPreference(input: {
    reminderId?: string
    taskId?: string
    kind: TaskReminder['kind']
    action: 'helpful' | 'snooze' | 'mute_kind' | 'restore_kind'
  }): ReminderPreferences {
    const allowedKinds = new Set<TaskReminder['kind']>(['overdue', 'due_soon', 'waiting_stale', 'blocked'])
    const allowedActions = new Set(['helpful', 'snooze', 'mute_kind', 'restore_kind'])
    if (!allowedKinds.has(input?.kind) || !allowedActions.has(input?.action)) throw new Error('无效的提醒反馈')
    const preferences = normalizeReminderPreferences(this.state.reminderPreferences)
    const now = new Date()
    if (input.action === 'snooze') {
      if (!input.reminderId) throw new Error('缺少提醒 ID')
      preferences.snoozedUntil[input.reminderId] = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    } else if (input.action === 'mute_kind') {
      preferences.mutedKinds = [...new Set([...preferences.mutedKinds, input.kind])]
    } else if (input.action === 'restore_kind') {
      preferences.mutedKinds = preferences.mutedKinds.filter(kind => kind !== input.kind)
    }
    preferences.history.push({
      reminderId: String(input.reminderId || ''),
      taskId: String(input.taskId || ''),
      kind: input.kind,
      action: input.action,
      createdAt: now.toISOString()
    })
    preferences.history = preferences.history.slice(-200)
    this.state.reminderPreferences = preferences
    this.saveState()
    return preferences
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

  updateMemoryItemStatus(kind: 'claim' | 'event', id: string, status: 'confirmed' | 'rejected'): any {
    return personalMemoryStore.updateMemoryItemStatus(kind, id, status)
  }

  deleteMemoryResource(id: string): any {
    return personalMemoryStore.deleteResource(id)
  }

  reviewMemoryDocument(kind: 'relation' | 'claim' | 'event', id: string, decision: 'confirmed' | 'rejected'): any {
    if (kind === 'claim' || kind === 'event') return personalMemoryStore.updateMemoryItemStatus(kind, id, decision)
    const relation = this.state.graph.relations.find(item => item.id === id)
    if (!relation) return null
    relation.status = decision
    relation.updatedAt = new Date().toISOString()
    for (const review of this.state.graph.reviewQueue) {
      if (review.kind === 'relation' && review.relationId === id && review.status === 'pending') review.status = decision
    }
    this.saveState()
    return relation
  }

  previewForgetEntity(id: string): any {
    const entity = this.state.graph.entities.find(item => item.id === id)
    const databasePreview = personalMemoryStore.previewForgetEntity(id)
    if (!entity || !databasePreview) return null
    const names = [...new Set([
      entity.canonicalName,
      ...(entity.aliases || []),
      ...(entity.accountIds || []),
      ...(databasePreview.names || [])
    ].map(value => String(value || '').trim().toLowerCase()).filter(value => value.length >= 2))]
    const taskIds = this.state.tasks.filter(task => [
      task.owner,
      ...(task.collaborators || []),
      task.project,
      task.title,
      task.detail,
      task.assignmentEvidence,
      ...(task.evidence || []).map(item => item.excerpt)
    ].some(value => names.some(name => String(value || '').toLowerCase().includes(name)))).map(task => task.id)
    return {
      ...databasePreview,
      taskIds,
      counts: {
        claims: databasePreview.claimIds.length,
        relations: databasePreview.relationIds.length,
        events: databasePreview.eventIds.length,
        tasks: taskIds.length
      }
    }
  }

  forgetEntity(id: string): any {
    const preview = this.previewForgetEntity(id)
    if (!preview) throw new Error('实体不存在或已被遗忘')
    const taskIds = new Set(preview.taskIds)
    this.state.tasks = this.state.tasks.filter(task => !taskIds.has(task.id))
    for (const briefing of Object.values(this.state.briefings)) {
      if (Array.isArray(briefing?.tasks)) briefing.tasks = briefing.tasks.filter((task: any) => !taskIds.has(task.id))
    }
    this.state.graph.entities = this.state.graph.entities.filter(entity => entity.id !== id)
    const relationIds = new Set(this.state.graph.relations
      .filter(relation => relation.subjectId === id || relation.objectId === id).map(relation => relation.id))
    this.state.graph.relations = this.state.graph.relations.filter(relation => !relationIds.has(relation.id))
    this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review =>
      review.leftEntityId !== id && review.rightEntityId !== id && (!review.relationId || !relationIds.has(review.relationId)))
    const result = personalMemoryStore.forgetEntity(id, [...taskIds])
    this.saveState()
    return result
  }

  searchMemory(query: string, limit = 200): any[] {
    return personalMemoryStore.searchText(String(query || ''), limit).map((item: any) => ({
      ...item,
      metadata: (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
      evidence: personalMemoryStore.getDocumentEvidence(item.document_type, item.source_id)
    }))
  }

  async searchMemoryHybrid(query: string, options: MemorySearchOptions = {}): Promise<any[]> {
    const selectedEntity = options.entityId ? this.state.graph.entities.find(entity => entity.id === options.entityId) : null
    const scopedOptions = selectedEntity
      ? { ...options, entityTerms: [selectedEntity.canonicalName, ...(selectedEntity.aliases || []), ...(selectedEntity.accountIds || [])] }
      : options
    const lexical = this.searchMemory(query, 300)
    try {
      await this.ensureVectorIndex()
      const [queryVector] = await localEmbeddingService.embed([String(query || '')])
      const semantic = personalMemoryStore.searchVector(queryVector, localEmbeddingService.modelVersion, 300)
      const merged = new Map<string, any>()
      lexical.forEach((item, index) => merged.set(item.id, {
        ...item,
        hybrid_score: 1 / (40 + index),
        match_source: '全文'
      }))
      semantic.forEach((item: any, index: number) => {
        if (Number(item.semantic_score || 0) < 0.35) return
        const existing = merged.get(item.id)
        const semanticContribution = Math.max(0, Number(item.semantic_score || 0)) * 0.035 + 1 / (60 + index)
        merged.set(item.id, {
          ...(existing || item),
          semantic_score: item.semantic_score,
          hybrid_score: Number(existing?.hybrid_score || 0) + semanticContribution,
          match_source: existing ? '全文 + 语义' : '语义',
          metadata: existing?.metadata || (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
          evidence: existing?.evidence || personalMemoryStore.getDocumentEvidence(item.document_type, item.source_id)
        })
      })
      return filterMemorySearchResults(
        [...merged.values()].sort((left, right) => Number(right.hybrid_score || 0) - Number(left.hybrid_score || 0)),
        scopedOptions
      ).slice(0, 40)
    } catch (error) {
      console.warn('[AI Assistant] 向量检索回退为全文检索:', error)
      return filterMemorySearchResults(lexical, scopedOptions).slice(0, 40)
    }
  }

  async ensureVectorIndex(): Promise<any> {
    if (this.vectorIndexPromise) return this.vectorIndexPromise
    this.vectorIndexPromise = (async () => {
      let indexed = 0
      while (true) {
        const documents = personalMemoryStore.listEmbeddingCandidates(localEmbeddingService.modelVersion, 24)
        if (!documents.length) break
        const vectors = await localEmbeddingService.embed(documents.map((item: any) => `${item.title}\n${item.search_text}`))
        documents.forEach((item: any, index: number) =>
          personalMemoryStore.saveEmbedding(item.id, localEmbeddingService.modelVersion, vectors[index]))
        indexed += documents.length
      }
      return { indexed, ...personalMemoryStore.getEmbeddingStats(localEmbeddingService.modelVersion) }
    })().finally(() => { this.vectorIndexPromise = null })
    return this.vectorIndexPromise
  }

  findGraphPath(fromId: string, toId: string, maxDepth = 5): any {
    const entities = new Map(this.state.graph.entities.map(entity => [entity.id, entity]))
    if (!entities.has(fromId) || !entities.has(toId)) return { found: false, entities: [], steps: [] }
    if (fromId === toId) return { found: true, entities: [entities.get(fromId)], steps: [] }
    const relations = this.state.graph.relations.filter(relation => relation.status !== 'rejected')
    const adjacency = new Map<string, Array<{ nextId: string; relation: GraphRelation; forward: boolean }>>()
    for (const relation of relations) {
      adjacency.set(relation.subjectId, [...(adjacency.get(relation.subjectId) || []), { nextId: relation.objectId, relation, forward: true }])
      adjacency.set(relation.objectId, [...(adjacency.get(relation.objectId) || []), { nextId: relation.subjectId, relation, forward: false }])
    }
    const queue: Array<{ entityId: string; steps: any[] }> = [{ entityId: fromId, steps: [] }]
    const visited = new Set([fromId])
    const safeDepth = Math.max(1, Math.min(8, Number(maxDepth) || 5))
    while (queue.length) {
      const current = queue.shift()!
      if (current.steps.length >= safeDepth) continue
      for (const edge of adjacency.get(current.entityId) || []) {
        if (visited.has(edge.nextId)) continue
        const steps = [...current.steps, {
          relationId: edge.relation.id,
          fromId: current.entityId,
          toId: edge.nextId,
          predicate: edge.relation.predicate,
          forward: edge.forward,
          status: edge.relation.status,
          confidence: edge.relation.confidence,
          evidence: edge.relation.evidence
        }]
        if (edge.nextId === toId) {
          const pathIds = [fromId, ...steps.map(step => step.toId)]
          return { found: true, entities: pathIds.map(id => entities.get(id)), steps }
        }
        visited.add(edge.nextId)
        queue.push({ entityId: edge.nextId, steps })
      }
    }
    return { found: false, entities: [], steps: [] }
  }

  findCommonNeighbors(fromId: string, toId: string): any {
    return {
      from: this.state.graph.entities.find(entity => entity.id === fromId) || null,
      to: this.state.graph.entities.find(entity => entity.id === toId) || null,
      common: findCommonGraphNeighbors(fromId, toId, this.state.graph.entities, this.state.graph.relations)
    }
  }

  async askMemory(question: string, conversationId?: string, options: MemorySearchOptions = {}): Promise<any> {
    const query = String(question || '').trim()
    if (!query) throw new Error('请输入问题')
    const plan = buildMemoryQueryPlan(query, this.state.graph.entities)
    const plannedOptions: MemorySearchOptions = {
      ...plan.inferredOptions,
      ...options,
      documentTypes: options.documentTypes?.length ? options.documentTypes : plan.inferredOptions.documentTypes,
      relationTypes: options.relationTypes?.length ? options.relationTypes : plan.inferredOptions.relationTypes
    }
    const mergedResults = new Map<string, any>()
    let plannedGraphPath: any = null
    if (plan.matchedEntities.length >= 2) {
      plannedGraphPath = this.findGraphPath(plan.matchedEntities[0].id, plan.matchedEntities[1].id, 6)
      if (plannedGraphPath.found && plannedGraphPath.steps.length) {
        const names = new Map(this.state.graph.entities.map(entity => [entity.id, entity.canonicalName]))
        const pathResults = plannedGraphPath.steps.map((step: any) => ({
          id: `relation:${step.relationId}`,
          document_type: 'relation',
          source_id: step.relationId,
          title: step.predicate,
          search_text: `${names.get(step.fromId) || step.fromId} ${step.forward ? step.predicate : `反向:${step.predicate}`} ${names.get(step.toId) || step.toId}`,
          metadata: { subjectId: step.fromId, objectId: step.toId, predicate: step.predicate, status: step.status },
          evidence: step.evidence,
          hybrid_score: 1,
          match_source: '图路径'
        }))
        for (const result of filterMemorySearchResults(pathResults, plannedOptions)) mergedResults.set(result.id, result)
        plan.explanation.push(`图路径：${plannedGraphPath.steps.length} 跳`)
      } else {
        plan.explanation.push('图路径：未找到已知连接')
      }
    }
    for (const plannedQuery of plan.queries.slice(0, 6)) {
      for (const result of await this.searchMemoryHybrid(plannedQuery, plannedOptions)) {
        const existing = mergedResults.get(result.id)
        if (!existing || Number(result.hybrid_score || 0) > Number(existing.hybrid_score || 0)) mergedResults.set(result.id, result)
      }
    }
    let results = [...mergedResults.values()]
      .sort((left, right) => Number(right.hybrid_score || 0) - Number(left.hybrid_score || 0))
      .slice(0, 40)
    if (!results.length) {
      const terms = query.match(/[A-Za-z0-9@._-]{2,}|[\u4e00-\u9fff]{2,}/g) || []
      const merged = new Map<string, any>()
      for (const term of terms.slice(0, 6)) {
        for (const result of await this.searchMemoryHybrid(term, plannedOptions)) merged.set(result.id, result)
      }
      results = [...merged.values()].slice(0, 30)
    }
    const context = results.slice(0, 20).map((item: any) => ({
      documentId: item.id,
      sourceId: item.source_id,
      type: item.document_type,
      title: item.title,
      content: item.search_text,
      status: item.metadata?.status,
      evidence: item.evidence,
      canSupportFacts: Array.isArray(item.evidence) && item.evidence.length > 0
    }))
    const apiKey = String(this.config.get('aiAssistantApiKey') || '').trim()
    if (!apiKey) throw new Error('请先设置 DeepSeek API Key')
    const baseUrl = String(this.config.get('aiAssistantApiBaseUrl') || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = String(this.config.get('aiAssistantApiModel') || 'deepseek-v4-flash')
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: 1800, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是本地个人记忆问答助手。只能依据提供的检索结果回答；证据不足必须明确说不知道。只有 canSupportFacts=true 且包含原始 evidence 的文档可以支持事实结论；没有原始 evidence 的实体摘要只能作为检索线索，不能作为事实依据。每个事实结论必须引用能够支持它的 documentId。只输出 JSON：{"answer":"回答","citationIds":["documentId"],"uncertainty":"不确定性说明"}。' },
          { role: 'user', content: `问题：${query}\n查询规划：${JSON.stringify(plan)}\n最终检索范围：${JSON.stringify(plannedOptions)}\n本地检索结果：${JSON.stringify(context)}` }
        ]
      }),
      signal: AbortSignal.timeout(90_000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek 请求失败 (${response.status})`)
    const parsed = parseModelJson(payload?.choices?.[0]?.message?.content)
    const allowed = new Set(context.filter(item => item.canSupportFacts).map(item => item.documentId))
    const citationIds = (Array.isArray(parsed.citationIds) ? parsed.citationIds : []).map(String).filter((id: string) => allowed.has(id))
    const citations = context.filter(item => citationIds.includes(item.documentId))
    const answer = String(parsed.answer || '没有足够证据回答。').slice(0, 6000)
    const id = personalMemoryStore.saveAssistantExchange(query, answer, citations, conversationId)
    return {
      conversationId: id,
      answer,
      uncertainty: String(parsed.uncertainty || ''),
      citations,
      queryPlan: {
        ...plan,
        appliedOptions: plannedOptions,
        graphPath: plannedGraphPath ? {
          found: plannedGraphPath.found,
          entities: plannedGraphPath.entities?.map((entity: any) => entity?.canonicalName).filter(Boolean),
          steps: plannedGraphPath.steps?.map((step: any) => ({ predicate: step.predicate, forward: step.forward }))
        } : null
      }
    }
  }

  correctClaim(id: string, input: any): any {
    return personalMemoryStore.correctClaim(id, input)
  }

  private async schedulerTick(): Promise<void> {
    if (!this.config.get('aiAssistantEnabled')) return
    const now = new Date()
    if (!this.activeSync) await this.flushNotificationOutbox(now)
    if (this.activeSync) return
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const today = shanghaiDate()
    const schedule = String(this.config.get('aiAssistantScheduleTime') || '20:00')
    if (time < schedule || this.state.cursor.lastScheduledRunDate === today) return
    if (Date.now() - this.lastSchedulerAttemptAt < 15 * 60_000) return
    this.lastSchedulerAttemptAt = Date.now()
    try {
      await this.sync()
      this.state.cursor.lastScheduledRunDate = today
      const reminders = applyReminderPreferences(
        buildTaskReminders(this.state.tasks.filter(task => task.classification === 'mine'), now),
        this.state.reminderPreferences,
        now
      ).visible
      if (reminders.length && this.state.cursor.lastReminderNotificationDate !== today) {
        this.enqueueNotification({
          key: `task-reminders:${today}`,
          title: `AI 助理：${reminders.length} 项需要留意`,
          content: reminders.slice(0, 2).map(item => `${item.title}（${item.reason}）`).join('；'),
          createdAt: now.toISOString()
        })
        this.state.cursor.lastReminderNotificationDate = today
      }
      this.saveState()
      await this.flushNotificationOutbox(now)
    } catch {}
  }

  private isNotificationQuiet(now: Date): boolean {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(now)
    return isQuietTime(
      time,
      String(this.config.get('aiAssistantQuietStart') || '22:00'),
      String(this.config.get('aiAssistantQuietEnd') || '08:00')
    )
  }

  private enqueueNotification(notification: { key: string; title: string; content: string; createdAt: string }): boolean {
    return enqueueUniqueNotification(this.state.notifications, notification)
  }

  private async flushNotificationOutbox(now: Date): Promise<void> {
    if (this.isNotificationQuiet(now) || !this.state.notifications.pending.length) return
    for (const notification of [...this.state.notifications.pending].slice(0, 5)) {
      try {
        await showSystemNotification({
          title: notification.title,
          content: notification.content,
          channel: 'ai-assistant',
          targetRoute: '/ai-assistant'
        })
        markNotificationAttempt(this.state.notifications, notification.key, { success: true })
      } catch (error: any) {
        markNotificationAttempt(this.state.notifications, notification.key, {
          success: false,
          error: sanitizeDiagnosticText(error)
        })
        break
      }
    }
    this.saveState()
  }
}

export const aiAssistantService = new AiAssistantService()
