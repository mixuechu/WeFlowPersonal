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
  unknown_interruption: '进程意外中断或设备断电'
}

const INCIDENT_LABELS: Record<string, string> = {
  renderer_gone: '界面进程退出',
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
