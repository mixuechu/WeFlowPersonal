const STAGE_LABELS: Record<string, string> = {
  starting: '正在启动',
  ready: '界面已就绪',
  services_ready: '全部服务已就绪',
  shutting_down: '正在安全退出',
  ended: '已结束'
}

const EXIT_REASON_LABELS: Record<string, string> = {
  normal: '正常退出',
  update_restart: '更新后重启',
  forced_timeout: '安全退出超时',
  uncaught_exception: '未捕获异常',
  shutdown_interrupted: '安全退出途中中断',
  unknown_interruption: '进程意外中断或设备断电'
}

const INCIDENT_LABELS: Record<string, string> = {
  renderer_gone: '界面进程退出',
  renderer_page_error: '页面渲染失败',
  child_process_gone: '子进程退出',
  uncaught_exception: '未捕获异常',
  unhandled_rejection: '未处理异步错误'
}

const SHUTDOWN_STEP_LABELS: Record<string, string> = {
  'ai-assistant-stop': 'AI 助理停止',
  'cloud-control-stop': '云端控制停止',
  'image-download-stop': '图片下载停止',
  'chat-js-state-stop': '聊天状态停止',
  'http-server-stop': '本机服务停止',
  'wcdb-worker-stop': '微信数据库停止'
}

const SHUTDOWN_STATUS_LABELS: Record<string, string> = {
  running: '执行中被中断',
  completed: '已完成',
  failed: '失败'
}

export const appRunStageLabel = (stage: unknown): string => STAGE_LABELS[String(stage || '')] || '未知阶段'

export const appRunExitReasonLabel = (reason: unknown, cleanExit = false): string => {
  const normalized = String(reason || '')
  if (EXIT_REASON_LABELS[normalized]) return EXIT_REASON_LABELS[normalized]
  return cleanExit ? '正常结束' : '未知原因'
}

export const appRunIncidentLabel = (kind: unknown): string => INCIDENT_LABELS[String(kind || '')] || '运行异常'

export const appRunShutdownStepLabel = (name: unknown): string => SHUTDOWN_STEP_LABELS[String(name || '')] || String(name || '未知步骤')

export const appRunShutdownStatusLabel = (status: unknown): string => SHUTDOWN_STATUS_LABELS[String(status || '')] || '未知状态'

const parseShutdownDetail = (detail: unknown): Record<string, unknown> | null => {
  if (typeof detail !== 'string' || !detail.trim().startsWith('{')) return null
  try {
    const value = JSON.parse(detail)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const appRunShutdownDetailLabel = (name: unknown, detail: unknown): string => {
  const text = typeof detail === 'string' ? detail.trim().slice(0, 300) : ''
  if (!text) return ''
  const parsed = parseShutdownDetail(text)
  if (!parsed) return text

  if (String(name || '') === 'wcdb-worker-stop') {
    const strategy = String(parsed.shutdownStrategy || '')
    if (strategy === 'process_exit_detach') {
      return '只读 Worker 已确认静默，并随应用退出回收'
    }
    if (strategy === 'no_worker') return '本次没有已启动的微信数据库 Worker'
    const pending = Math.max(0, Math.floor(Number(parsed.pendingBeforeClose) || 0))
    if (strategy === 'forced_terminate' || parsed.boundedFallback === true) {
      return parsed.workerTerminated === true
        ? `原生请求未及时结束，已强制停止 Worker${pending ? `（退出前 ${pending} 项）` : ''}`
        : `原生请求未及时结束，已进入有界退出兜底${pending ? `（退出前 ${pending} 项）` : ''}`
    }
    if (parsed.gracefulClose === true) return '微信数据库 Worker 已正常停止'
  }

  if (String(name || '') === 'ai-assistant-stop') {
    const waited = Math.max(0, Math.floor(Number(parsed.waited) || 0))
    const pending = Array.isArray(parsed.pending) ? parsed.pending.length : 0
    if (parsed.timedOut === true) {
      return `等待后台任务达到上限，仍有 ${pending} 项交由进程退出回收`
    }
    return `后台任务已落定${waited ? `（等待 ${waited} 项）` : ''}，记忆数据库${parsed.databaseClosed === false ? '由进程退出回收' : '已安全关闭'}`
  }

  return '已记录结构化诊断详情'
}

export const appRunShutdownDetailNeedsAttention = (
  name: unknown,
  detail: unknown
): boolean => {
  const parsed = parseShutdownDetail(detail)
  if (!parsed) return false
  if (String(name || '') === 'wcdb-worker-stop') {
    return parsed.boundedFallback === true ||
      String(parsed.shutdownStrategy || '') === 'forced_terminate'
  }
  if (String(name || '') === 'ai-assistant-stop') return parsed.timedOut === true
  return false
}

export const appRunDurationLabel = (durationMs: unknown): string => {
  const milliseconds = Number(durationMs)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '耗时未知'
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} 毫秒`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} 秒`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor(milliseconds % 60_000 / 1_000)
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
}

export const appRunElapsedLabel = (startedAt: unknown, endedAt: unknown): string => {
  const started = Date.parse(String(startedAt || ''))
  const ended = Date.parse(String(endedAt || ''))
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return '持续时间未知'
  return `持续 ${appRunDurationLabel(ended - started)}`
}
