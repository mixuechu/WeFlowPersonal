import crypto from 'node:crypto'

export type AssistantSettingsMutationIdentity = {
  configured: boolean
  apiKeySecret: string
  baseUrl: unknown
  model: unknown
  scheduleTime: unknown
  quietStart: unknown
  quietEnd: unknown
  inputCostPerMillion: unknown
  outputCostPerMillion: unknown
  enabled: unknown
  ownerName: unknown
  ownerAliases: unknown
  ownerBackground: unknown
  ownerEntityId: unknown
  ownerEntityRevision: unknown
  transcribeVoice: unknown
  ocrImages: unknown
  analyzeImages: unknown
  indexWebLinks: unknown
  resourceTrashRetentionDays: unknown
  sensitiveRedactionLevel: unknown
}

export type AssistantSettingsConfigPatch = {
  aiAssistantApiKey?: string
  aiAssistantApiBaseUrl: string
  aiAssistantApiModel: string
  aiAssistantScheduleTime: string
  aiAssistantQuietStart: string
  aiAssistantQuietEnd: string
  aiAssistantInputCostPerMillion: number
  aiAssistantOutputCostPerMillion: number
  aiAssistantEnabled: boolean
  aiAssistantOwnerName: string
  aiAssistantOwnerAliases: string
  aiAssistantOwnerBackground: string
  aiAssistantOwnerEntityId: string
  autoTranscribeVoice: boolean
  aiAssistantOcrImages: boolean
  aiAssistantAnalyzeImages: boolean
  aiAssistantIndexWebLinks: boolean
  aiAssistantResourceTrashRetentionDays: 0 | 7 | 30 | 90
  aiAssistantSensitiveRedactionLevel: 'credentials' | 'standard' | 'strict'
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效，请重新核对`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return normalized
}

function optionalString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效，请重新核对`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return normalized
}

function timeOfDay(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 5)
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error(`${label}必须是 00:00 到 23:59 之间的有效时间`)
  }
  return normalized
}

function nonNegativeCost(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${label}必须是 0 到 1000000 之间的有效数字`)
  }
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}格式无效，请重新核对`)
  return value
}

export function normalizeAssistantSettingsInput(input: unknown): AssistantSettingsConfigPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('AI 助理设置格式无效，请重新打开设置')
  }
  const source = input as Record<string, unknown>
  const baseUrl = requiredString(source.baseUrl, 'API 地址', 2048)
  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  } catch {
    throw new Error('API 地址必须是有效的 http 或 https 地址')
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || !parsedBaseUrl.hostname) {
    throw new Error('API 地址必须是有效的 http 或 https 地址')
  }
  const retention = source.resourceTrashRetentionDays
  if (![0, 7, 30, 90].includes(retention as number)) {
    throw new Error('资源回收站保留期必须是永不、7 天、30 天或 90 天')
  }
  const redaction = source.sensitiveRedactionLevel
  if (!['credentials', 'standard', 'strict'].includes(String(redaction))) {
    throw new Error('敏感信息脱敏级别无效，请重新选择')
  }
  const patch: AssistantSettingsConfigPatch = {
    aiAssistantApiBaseUrl: baseUrl,
    aiAssistantApiModel: requiredString(source.model, '模型', 200),
    aiAssistantScheduleTime: timeOfDay(source.scheduleTime, '每日整理时间'),
    aiAssistantQuietStart: timeOfDay(source.quietStart, '静默开始时间'),
    aiAssistantQuietEnd: timeOfDay(source.quietEnd, '静默结束时间'),
    aiAssistantInputCostPerMillion: nonNegativeCost(source.inputCostPerMillion, '输入费率'),
    aiAssistantOutputCostPerMillion: nonNegativeCost(source.outputCostPerMillion, '输出费率'),
    aiAssistantEnabled: requiredBoolean(source.enabled, '自动整理开关'),
    aiAssistantOwnerName: optionalString(source.ownerName, '我的姓名', 200),
    aiAssistantOwnerAliases: optionalString(source.ownerAliases, '我的常用称呼', 2000),
    aiAssistantOwnerBackground: optionalString(source.ownerBackground, '我的背景信息', 10000),
    aiAssistantOwnerEntityId: optionalString(source.ownerEntityId ?? '', '我的图谱身份', 200),
    autoTranscribeVoice: requiredBoolean(source.transcribeVoice, '语音转写开关'),
    aiAssistantOcrImages: requiredBoolean(source.ocrImages, '图片文字识别开关'),
    aiAssistantAnalyzeImages: requiredBoolean(source.analyzeImages, '图片场景分析开关'),
    aiAssistantIndexWebLinks: requiredBoolean(source.indexWebLinks, '网页正文索引开关'),
    aiAssistantResourceTrashRetentionDays: retention as 0 | 7 | 30 | 90,
    aiAssistantSensitiveRedactionLevel:
      redaction as 'credentials' | 'standard' | 'strict'
  }
  if (source.apiKey !== undefined) {
    if (typeof source.apiKey !== 'string') throw new Error('DeepSeek API Key 格式无效')
    const apiKey = source.apiKey.trim()
    if (apiKey.length > 4096) throw new Error('DeepSeek API Key 不能超过 4096 个字符')
    if (apiKey) patch.aiAssistantApiKey = apiKey
  }
  return patch
}

export function buildAssistantSettingsMutationToken(
  identity: AssistantSettingsMutationIdentity
): string {
  const { apiKeySecret, ...visible } = identity
  return crypto.createHash('sha256').update(JSON.stringify({
    ...visible,
    apiKeySha256: crypto.createHash('sha256').update(String(apiKeySecret || '')).digest('hex')
  })).digest('hex')
}

export function assertAssistantSettingsMutationToken(
  current: AssistantSettingsMutationIdentity,
  expectedMutationToken: unknown
): void {
  if (!String(expectedMutationToken || '') ||
      expectedMutationToken !== buildAssistantSettingsMutationToken(current)) {
    throw new Error('AI 助理设置在展示后发生了变化，请刷新后重新核对')
  }
}
