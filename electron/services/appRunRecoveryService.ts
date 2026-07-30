import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'

export type AppRunExitReason =
  | 'normal'
  | 'update_restart'
  | 'forced_timeout'
  | 'uncaught_exception'
  | 'unknown_interruption'

export type AppRunIncident = {
  at: string
  kind: 'renderer_gone' | 'child_process_gone' | 'uncaught_exception' | 'unhandled_rejection'
  detail: string
  fatal: boolean
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
}

type AppRunLedger = {
  schemaVersion: 1
  current: AppRunSession | null
  history: AppRunSession[]
}

const emptyLedger = (): AppRunLedger => ({ schemaVersion: 1, current: null, history: [] })

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
      const interrupted: AppRunSession = {
        ...this.ledger.current,
        stage: 'ended',
        endedAt: now.toISOString(),
        exitReason: this.ledger.current.exitReason || 'unknown_interruption',
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

  finishShutdown(reason?: Exclude<AppRunExitReason, 'unknown_interruption'>, now = new Date()): void {
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
    const recoveredFromInterruption = previous?.exitReason === 'unknown_interruption'
      || previous?.exitReason === 'uncaught_exception'
      || previous?.exitReason === 'forced_timeout'
    return {
      current: this.ledger.current ? { ...this.ledger.current } : null,
      previous,
      history,
      recoveredFromInterruption,
      recoveryMessage: !previous
        ? '尚无历史运行记录'
        : previous.cleanExit
          ? '上次运行正常结束'
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
        current: parsed.current && typeof parsed.current === 'object' ? parsed.current : null,
        history: parsed.history.filter((item: unknown) => item && typeof item === 'object').slice(0, 30)
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
