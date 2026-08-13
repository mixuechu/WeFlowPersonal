export const BACKGROUND_HEALTH_RUNTIME_TARGET = 'message-resources' as const
export const BACKGROUND_HEALTH_PERSISTENCE_TARGET = 'memory-diagnostics' as const
export const BACKGROUND_HEALTH_DIAGNOSTICS_TARGET = BACKGROUND_HEALTH_RUNTIME_TARGET

export type BackgroundHealthIncidentKind =
  | 'model_result_persistence'
  | 'operational_record_persistence'
  | 'derived_cache_persistence'
  | 'legacy_ai_service'
  | 'scheduler_runtime'
  | 'prepared_recovery'
  | 'resource_enrichment'
  | 'resource_content_budget'

export type BackgroundHealthSeverity = 'critical' | 'warning'

export type BackgroundHealthIncident = {
  kind: BackgroundHealthIncidentKind
  title: string
  detail: string
  nextAttemptAt: string
  failures: number
  severity: BackgroundHealthSeverity
  diagnosticsTarget: typeof BACKGROUND_HEALTH_RUNTIME_TARGET | typeof BACKGROUND_HEALTH_PERSISTENCE_TARGET
}

export type BackgroundHealthPresentation = {
  count: number
  primary: BackgroundHealthIncident
  nextAttemptAt: string
  severity: BackgroundHealthSeverity
  diagnosticsTarget: BackgroundHealthIncident['diagnosticsTarget']
}

const asFailureCount = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

const runtimeIncident = (
  kind: BackgroundHealthIncidentKind,
  title: string,
  state: any,
  failureField = 'failures'
): BackgroundHealthIncident | null => {
  if (!String(state?.lastError || '').trim()) return null
  return {
    kind,
    title,
    detail: '后台任务已自动进入有界退避，不会高频空转',
    nextAttemptAt: String(state?.nextAttemptAt || ''),
    failures: asFailureCount(state?.[failureField]),
    severity: 'warning',
    diagnosticsTarget: BACKGROUND_HEALTH_RUNTIME_TARGET
  }
}

const PERSISTENCE_CACHE_GROUPS = [
  {
    kind: 'model_result_persistence' as const,
    caches: ['insightProfiles', 'insightRecords', 'groupSummaryRecords'],
    title: '模型生成成果正在等待安全补写',
    detail: '成果仍保留在本次运行内存中，系统会自动重试；补写成功前请避免强制退出或断电',
    severity: 'critical' as const
  },
  {
    kind: 'operational_record_persistence' as const,
    caches: ['exportRecords'],
    title: '操作历史正在等待安全补写',
    detail: '已导出的文件不受影响，系统正在自动补写内部操作记录',
    severity: 'warning' as const
  },
  {
    kind: 'derived_cache_persistence' as const,
    caches: ['contacts', 'sessionMessages', 'sessionStats', 'groupMyMessageCounts', 'cacheMaps'],
    title: '本地派生缓存正在等待补写',
    detail: 'SQLCipher 权威个人记忆未受影响；这些缓存可从本机数据重新生成',
    severity: 'warning' as const
  }
] as const

const persistenceIncidents = (memoryDiagnostics: any): BackgroundHealthIncident[] => {
  const caches = memoryDiagnostics?.privacy?.sensitiveCaches
  if (!caches) return []

  return PERSISTENCE_CACHE_GROUPS.flatMap(group => {
    const retries = group.caches
      .map(cache => caches?.[cache]?.persistenceRetry)
      .filter(retry => String(retry?.lastError || '').trim())
    if (!retries.length) return []
    const nextAttemptAt = retries
      .map(retry => String(retry?.nextAttemptAt || ''))
      .filter(value => value && Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || ''
    return [{
      kind: group.kind,
      title: group.title,
      detail: group.detail,
      nextAttemptAt,
      failures: retries.reduce((total, retry) => total + asFailureCount(retry?.failureCount), 0),
      severity: group.severity,
      diagnosticsTarget: BACKGROUND_HEALTH_PERSISTENCE_TARGET
    }]
  })
}

const legacyAiServiceIncident = (memoryDiagnostics: any): BackgroundHealthIncident | null => {
  const services = memoryDiagnostics?.legacyBackgroundServices
  if (!services) return null
  const labels: Record<string, string> = {
    insight: '联系人见解',
    groupSummary: '群聊自动总结',
    messagePush: '消息推送'
  }
  const failed = Object.entries(labels)
    .map(([key, label]) => ({ label, health: services?.[key] }))
    .filter(item => String(item.health?.lastError || item.health?.retry?.lastError || '').trim())
  if (!failed.length) return null
  return {
    kind: 'legacy_ai_service',
    title: `${failed.map(item => item.label).join('、')}后台运行暂时受阻`,
    detail: '异常已被安全隔离，不会导致应用退出；系统会按加密保存的退避时间自动重试',
    nextAttemptAt: failed.map(item => String(item.health?.retry?.nextAttemptAt || ''))
      .filter(value => value && Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || '',
    failures: failed.reduce((total, item) =>
      total + Math.max(
        asFailureCount(item.health?.consecutiveFailures),
        asFailureCount(item.health?.retry?.failures)
      ), 0),
    severity: 'warning',
    diagnosticsTarget: BACKGROUND_HEALTH_PERSISTENCE_TARGET
  }
}

export const buildBackgroundHealthPresentation = (
  dashboard: any,
  memoryDiagnostics?: any
): BackgroundHealthPresentation | null => {
  const incidents = [
    ...persistenceIncidents(memoryDiagnostics),
    legacyAiServiceIncident(memoryDiagnostics),
    runtimeIncident('scheduler_runtime', '后台增量调度暂时受阻', dashboard?.schedulerRuntime),
    runtimeIncident('prepared_recovery', '中断批次的后台恢复暂时受阻', dashboard?.preparedRecoveryScheduler),
    runtimeIncident('resource_enrichment', '资源补全队列检查暂时受阻', dashboard?.resourceEnrichmentScheduler),
    runtimeIncident(
      'resource_content_budget',
      '历史资源边界核验暂时受阻',
      dashboard?.resourceContentBudget?.migration,
      'failureStreak'
    )
  ].filter((item): item is BackgroundHealthIncident => Boolean(item))

  if (!incidents.length) return null

  const nextAttemptAt = incidents
    .map(item => item.nextAttemptAt)
    .filter(value => value && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || ''
  const primary = incidents.find(item => item.severity === 'critical') || incidents[0]

  return {
    count: incidents.length,
    primary,
    nextAttemptAt,
    severity: primary.severity,
    diagnosticsTarget: primary.diagnosticsTarget
  }
}
