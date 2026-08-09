import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'

export type AppRunExitReason =
  | 'normal'
  | 'update_restart'
  | 'forced_timeout'
  | 'uncaught_exception'
  | 'shutdown_interrupted'
  | 'unknown_interruption'

export type AppRunIncident = {
  at: string
  kind: 'renderer_gone' | 'renderer_page_error' | 'child_process_gone' | 'uncaught_exception' | 'unhandled_rejection'
  detail: string
  fatal: boolean
}

export type AppRunShutdownStep = {
  name: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  endedAt?: string
  durationMs?: number
  detail?: string
}

export type AppRunSession = {
  id: string
  version: string
  startedAt: string
  lastHeartbeatAt: string
  readyAt?: string
  servicesReadyAt?: string
  shutdownStartedAt?: string
  endedAt?: string
  stage: 'starting' | 'ready' | 'services_ready' | 'shutting_down' | 'ended'
  exitReason?: AppRunExitReason
  cleanExit: boolean
  incidents: AppRunIncident[]
  shutdownSteps?: AppRunShutdownStep[]
}

type AppRunLedger = {
  schemaVersion: 1
  current: AppRunSession | null
  history: AppRunSession[]
}

const emptyLedger = (): AppRunLedger => ({ schemaVersion: 1, current: null, history: [] })

const SESSION_STAGES = new Set<AppRunSession['stage']>(['starting', 'ready', 'services_ready', 'shutting_down', 'ended'])
const EXIT_REASONS = new Set<AppRunExitReason>([
  'normal', 'update_restart', 'forced_timeout', 'uncaught_exception',
  'shutdown_interrupted', 'unknown_interruption'
])
const INCIDENT_KINDS = new Set<AppRunIncident['kind']>([
  'renderer_gone', 'renderer_page_error', 'child_process_gone', 'uncaught_exception', 'unhandled_rejection'
])
const SHUTDOWN_STEP_STATUSES = new Set<AppRunShutdownStep['status']>(['running', 'completed', 'failed'])

const boundedText = (value: unknown, maximum: number): string => typeof value === 'string'
  ? sanitizeDiagnosticText(value).slice(0, maximum)
  : ''

const boundedTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return value.slice(0, 40)
}

const normalizePersistedSession = (value: unknown): AppRunSession | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = boundedText(raw.id, 100)
  const version = boundedText(raw.version, 40)
  const startedAt = boundedTimestamp(raw.startedAt)
  const lastHeartbeatAt = boundedTimestamp(raw.lastHeartbeatAt)
  const stage = SESSION_STAGES.has(raw.stage as AppRunSession['stage'])
    ? raw.stage as AppRunSession['stage']
    : null
  if (!id || !version || !startedAt || !lastHeartbeatAt || !stage) return null

  const incidents = (Array.isArray(raw.incidents) ? raw.incidents : [])
    .slice(-20)
    .flatMap((item): AppRunIncident[] => {
      if (!item || typeof item !== 'object') return []
      const incident = item as Record<string, unknown>
      const at = boundedTimestamp(incident.at)
      const kind = INCIDENT_KINDS.has(incident.kind as AppRunIncident['kind'])
        ? incident.kind as AppRunIncident['kind']
        : null
      if (!at || !kind) return []
      return [{
        at,
        kind,
        detail: boundedText(incident.detail, 300) || '未提供错误详情',
        fatal: incident.fatal === true
      }]
    })
  const shutdownSteps = (Array.isArray(raw.shutdownSteps) ? raw.shutdownSteps : [])
    .slice(-20)
    .flatMap((item): AppRunShutdownStep[] => {
      if (!item || typeof item !== 'object') return []
      const step = item as Record<string, unknown>
      const name = boundedText(step.name, 80)
      const status = SHUTDOWN_STEP_STATUSES.has(step.status as AppRunShutdownStep['status'])
        ? step.status as AppRunShutdownStep['status']
        : null
      const stepStartedAt = boundedTimestamp(step.startedAt)
      if (!name || !status || !stepStartedAt) return []
      const endedAt = boundedTimestamp(step.endedAt)
      const durationMs = typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)
        ? Math.max(0, Math.min(step.durationMs, 86_400_000))
        : undefined
      const detail = boundedText(step.detail, 300)
      return [{
        name,
        status,
        startedAt: stepStartedAt,
        ...(endedAt ? { endedAt } : {}),
        ...(durationMs == null ? {} : { durationMs }),
        ...(detail ? { detail } : {})
      }]
    })
  const exitReason = EXIT_REASONS.has(raw.exitReason as AppRunExitReason)
    ? raw.exitReason as AppRunExitReason
    : undefined

  return {
    id,
    version,
    startedAt,
    lastHeartbeatAt,
    stage,
    cleanExit: raw.cleanExit === true,
    incidents,
    ...(boundedTimestamp(raw.readyAt) ? { readyAt: boundedTimestamp(raw.readyAt) } : {}),
    ...(boundedTimestamp(raw.servicesReadyAt) ? { servicesReadyAt: boundedTimestamp(raw.servicesReadyAt) } : {}),
    ...(boundedTimestamp(raw.shutdownStartedAt) ? { shutdownStartedAt: boundedTimestamp(raw.shutdownStartedAt) } : {}),
    ...(boundedTimestamp(raw.endedAt) ? { endedAt: boundedTimestamp(raw.endedAt) } : {}),
    ...(exitReason ? { exitReason } : {}),
    ...(shutdownSteps.length > 0 ? { shutdownSteps } : {})
  }
}

export class AppRunRecoveryService {
  private readonly ledgerPath: string
  private ledger: AppRunLedger = emptyLedger()
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(userDataPath: string) {
    this.ledgerPath = join(userDataPath, 'diagnostics', 'app-run-recovery.json')
  }

  start(version: string, now = new Date()): AppRunSession {
    this.ledger = this.readLedger()
    if (this.ledger.current) {
      const shutdownInterrupted = this.ledger.current.stage === 'shutting_down'
      const interrupted: AppRunSession = {
        ...this.ledger.current,
        stage: 'ended',
        endedAt: now.toISOString(),
        exitReason: shutdownInterrupted
          ? 'shutdown_interrupted'
          : this.ledger.current.exitReason || 'unknown_interruption',
        cleanExit: false
      }
      this.ledger.history.unshift(interrupted)
    }
    const timestamp = now.toISOString()
    const current: AppRunSession = {
      id: randomUUID(),
      version,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      stage: 'starting',
      cleanExit: false,
      incidents: []
    }
    this.ledger.current = current
    this.trimAndWrite()
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000)
    this.heartbeatTimer.unref()
    return current
  }

  markReady(now = new Date()): void {
    this.updateCurrent(session => ({
      ...session,
      stage: 'ready',
      readyAt: session.readyAt || now.toISOString(),
      lastHeartbeatAt: now.toISOString()
    }))
  }

  markServicesReady(now = new Date()): void {
    this.updateCurrent(session => ({
      ...session,
      stage: 'services_ready',
      servicesReadyAt: session.servicesReadyAt || now.toISOString(),
      lastHeartbeatAt: now.toISOString()
    }))
  }

  beginShutdown(reason: 'normal' | 'update_restart' = 'normal', now = new Date()): void {
    this.stopHeartbeat()
    this.updateCurrent(session => ({
      ...session,
      stage: 'shutting_down',
      shutdownStartedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      exitReason: reason
    }))
  }

  startShutdownStep(name: string, now = new Date()): void {
    const normalizedName = String(name || '').trim().slice(0, 80)
    if (!normalizedName) return
    this.updateCurrent(session => ({
      ...session,
      lastHeartbeatAt: now.toISOString(),
      shutdownSteps: [
        ...(session.shutdownSteps || []),
        { name: normalizedName, status: 'running', startedAt: now.toISOString() } as AppRunShutdownStep
      ].slice(-20)
    }))
  }

  finishShutdownStep(
    name: string,
    status: 'completed' | 'failed' = 'completed',
    detail?: unknown,
    now = new Date()
  ): void {
    const normalizedName = String(name || '').trim().slice(0, 80)
    this.updateCurrent(session => {
      const steps = [...(session.shutdownSteps || [])]
      const index = steps.findLastIndex(step => step.name === normalizedName && step.status === 'running')
      if (index < 0) return session
      const startedAt = Date.parse(steps[index].startedAt)
      steps[index] = {
        ...steps[index],
        status,
        endedAt: now.toISOString(),
        durationMs: Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : undefined,
        ...(detail == null ? {} : { detail: sanitizeDiagnosticText(detail).slice(0, 300) })
      }
      return { ...session, lastHeartbeatAt: now.toISOString(), shutdownSteps: steps }
    })
  }

  finishShutdown(
    reason?: Exclude<AppRunExitReason, 'unknown_interruption' | 'shutdown_interrupted'>,
    now = new Date()
  ): void {
    this.stopHeartbeat()
    if (!this.ledger.current) return
    const completed: AppRunSession = {
      ...this.ledger.current,
      stage: 'ended',
      endedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      exitReason: reason || this.ledger.current.exitReason || 'normal',
      cleanExit: !['forced_timeout', 'uncaught_exception'].includes(reason || this.ledger.current.exitReason || 'normal')
    }
    this.ledger.history.unshift(completed)
    this.ledger.current = null
    this.trimAndWrite()
  }

  recordIncident(
    kind: AppRunIncident['kind'],
    detail: unknown,
    fatal = false,
    now = new Date()
  ): void {
    this.updateCurrent(session => ({
      ...session,
      lastHeartbeatAt: now.toISOString(),
      exitReason: fatal ? 'uncaught_exception' : session.exitReason,
      incidents: [
        ...session.incidents,
        {
          at: now.toISOString(),
          kind,
          detail: sanitizeDiagnosticText(detail) || '未提供错误详情',
          fatal
        }
      ].slice(-20)
    }))
  }

  getDiagnostics(): {
    current: AppRunSession | null
    previous: AppRunSession | null
    history: AppRunSession[]
    recoveredFromInterruption: boolean
    recoveryMessage: string
  } {
    const history = this.ledger.history.slice(0, 12)
    const previous = history[0] || null
    const previousExpectedExit = previous?.exitReason === 'normal' || previous?.exitReason === 'update_restart'
    const recoveredFromInterruption = !previousExpectedExit && (previous?.exitReason === 'unknown_interruption'
      || previous?.exitReason === 'uncaught_exception'
      || previous?.exitReason === 'shutdown_interrupted'
      || previous?.exitReason === 'forced_timeout')
    return {
      current: this.ledger.current ? { ...this.ledger.current } : null,
      previous,
      history,
      recoveredFromInterruption,
      recoveryMessage: !previous
        ? '尚无历史运行记录'
        : previous.cleanExit || previousExpectedExit
          ? '上次运行正常结束'
          : previous.exitReason === 'shutdown_interrupted'
            ? '上次安全退出未完成，已按持久化 checkpoint 恢复'
            : previous.exitReason === 'unknown_interruption'
            ? '检测到上次进程未完成退出，已按持久化 checkpoint 恢复'
            : previous.exitReason === 'forced_timeout'
              ? '上次退出超时，已按持久化 checkpoint 恢复'
              : '检测到上次运行异常，已保留诊断并按 checkpoint 恢复'
    }
  }

  dispose(): void {
    this.stopHeartbeat()
  }

  private heartbeat(now = new Date()): void {
    this.updateCurrent(session => ({ ...session, lastHeartbeatAt: now.toISOString() }))
  }

  private updateCurrent(update: (session: AppRunSession) => AppRunSession): void {
    if (!this.ledger.current) return
    this.ledger.current = update(this.ledger.current)
    this.trimAndWrite()
  }

  private readLedger(): AppRunLedger {
    if (!existsSync(this.ledgerPath)) return emptyLedger()
    try {
      const parsed = JSON.parse(readFileSync(this.ledgerPath, 'utf8'))
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.history)) return emptyLedger()
      return {
        schemaVersion: 1,
        current: normalizePersistedSession(parsed.current),
        history: parsed.history
          .slice(0, 30)
          .map(normalizePersistedSession)
          .filter((item: AppRunSession | null): item is AppRunSession => item !== null)
      }
    } catch {
      return emptyLedger()
    }
  }

  private trimAndWrite(): void {
    this.ledger.history = this.ledger.history.slice(0, 30)
    mkdirSync(dirname(this.ledgerPath), { recursive: true, mode: 0o700 })
    const temporary = `${this.ledgerPath}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(this.ledger, null, 2), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.ledgerPath)
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

let activeAppRunRecoveryService: AppRunRecoveryService | null = null

export function initializeAppRunRecoveryService(userDataPath: string): AppRunRecoveryService {
  activeAppRunRecoveryService?.dispose()
  activeAppRunRecoveryService = new AppRunRecoveryService(userDataPath)
  return activeAppRunRecoveryService
}

export function getAppRunRecoveryDiagnostics(): ReturnType<AppRunRecoveryService['getDiagnostics']> | null {
  return activeAppRunRecoveryService?.getDiagnostics() || null
}
