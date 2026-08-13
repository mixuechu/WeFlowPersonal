import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { appendFile } from 'fs/promises'
import { dirname, join } from 'path'

export const SENSITIVE_LOG_POLICY_VERSION = 'sensitive-local-log-v1'
export const SENSITIVE_LOG_MAX_BYTES = 2 * 1024 * 1024
export const SENSITIVE_LOG_RETAIN_BYTES = 512 * 1024

export function shouldWriteSensitiveLog(
  configuredEnabled: boolean,
  environmentOverride = process.env.WCDB_LOG_ENABLED
): boolean {
  return configuredEnabled || environmentOverride === '1'
}

type SensitiveLogAudit = {
  version: string
  cleanupRuns: number
  rotationRuns: number
  bytesRemovedTotal: number
  bytesRemovedThisStart: number
  lastAction: 'none' | 'disabled_cleanup' | 'rotated' | 'manual_clear'
  lastActionAt: string
}

const EMPTY_AUDIT: SensitiveLogAudit = {
  version: SENSITIVE_LOG_POLICY_VERSION,
  cleanupRuns: 0,
  rotationRuns: 0,
  bytesRemovedTotal: 0,
  bytesRemovedThisStart: 0,
  lastAction: 'none',
  lastActionAt: ''
}

function logPath(userDataPath: string): string {
  return join(userDataPath, 'logs', 'wcdb.log')
}

function auditPath(userDataPath: string): string {
  return join(userDataPath, 'diagnostics', 'sensitive-log-retention.json')
}

function readAudit(userDataPath: string): SensitiveLogAudit {
  try {
    return { ...EMPTY_AUDIT, ...JSON.parse(readFileSync(auditPath(userDataPath), 'utf8')) }
  } catch {
    return { ...EMPTY_AUDIT }
  }
}

function writeAudit(userDataPath: string, audit: SensitiveLogAudit): void {
  const path = auditPath(userDataPath)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(audit, null, 2), { mode: 0o600 })
  chmodSync(path, 0o600)
}

function retainedTail(content: Buffer): Buffer {
  const tail = content.subarray(Math.max(0, content.length - SENSITIVE_LOG_RETAIN_BYTES))
  const newline = tail.indexOf(0x0a)
  return newline >= 0 && newline + 1 < tail.length ? tail.subarray(newline + 1) : tail
}

export function enforceSensitiveLogFileLimit(path: string): number {
  try {
    if (!existsSync(path)) return 0
    chmodSync(path, 0o600)
    const before = statSync(path).size
    if (before <= SENSITIVE_LOG_MAX_BYTES) return 0
    const tail = retainedTail(readFileSync(path))
    const notice = Buffer.from(
      `[${new Date().toISOString()}] [privacy] 诊断日志已按本机敏感日志策略轮转，仅保留最近片段。\n`
    )
    writeFileSync(path, Buffer.concat([notice, tail]), { mode: 0o600 })
    chmodSync(path, 0o600)
    return Math.max(0, before - statSync(path).size)
  } catch {
    return 0
  }
}

function removeStaleLock(lockPath: string): void {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > 30_000) unlinkSync(lockPath)
  } catch {}
}

async function acquireLogLock(lockPath: string): Promise<number | null> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return openSync(lockPath, 'wx', 0o600)
    } catch {
      removeStaleLock(lockPath)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  return null
}

const appendQueues = new Map<string, Promise<boolean>>()

async function appendSensitiveLogFileLocked(path: string, content: string): Promise<boolean> {
  if (!content) return true
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.privacy-lock`
  const lock = await acquireLogLock(lockPath)
  if (lock === null) return false
  try {
    enforceSensitiveLogFileLimit(path)
    await appendFile(path, content, { encoding: 'utf8', mode: 0o600 })
    enforceSensitiveLogFileLimit(path)
    chmodSync(path, 0o600)
    return true
  } finally {
    try { closeSync(lock) } catch {}
    try { unlinkSync(lockPath) } catch {}
  }
}

export function appendSensitiveLogFile(path: string, content: string): Promise<boolean> {
  const previous = appendQueues.get(path) || Promise.resolve(true)
  const next = previous
    .catch(() => false)
    .then(() => appendSensitiveLogFileLocked(path, content))
  appendQueues.set(path, next)
  const release = () => {
    if (appendQueues.get(path) === next) appendQueues.delete(path)
  }
  void next.then(release, release)
  return next
}

export function applySensitiveLogPolicy(
  userDataPath: string,
  enabled: boolean,
  action: 'startup' | 'manual_clear' = 'startup'
): SensitiveLogAudit {
  const path = logPath(userDataPath)
  const previous = readAudit(userDataPath)
  let removed = 0
  let lastAction: SensitiveLogAudit['lastAction'] = 'none'
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!enabled || action === 'manual_clear') {
    const before = existsSync(path) ? statSync(path).size : 0
    writeFileSync(path, '', { mode: 0o600 })
    chmodSync(path, 0o600)
    removed = before
    lastAction = action === 'manual_clear' ? 'manual_clear' : 'disabled_cleanup'
  } else {
    removed = enforceSensitiveLogFileLimit(path)
    if (removed > 0) lastAction = 'rotated'
  }
  const audit: SensitiveLogAudit = {
    version: SENSITIVE_LOG_POLICY_VERSION,
    cleanupRuns: Number(previous.cleanupRuns || 0) + (lastAction === 'disabled_cleanup' || lastAction === 'manual_clear' ? 1 : 0),
    rotationRuns: Number(previous.rotationRuns || 0) + (lastAction === 'rotated' ? 1 : 0),
    bytesRemovedTotal: Number(previous.bytesRemovedTotal || 0) + removed,
    bytesRemovedThisStart: action === 'startup' ? removed : Number(previous.bytesRemovedThisStart || 0),
    lastAction,
    lastActionAt: lastAction === 'none' ? String(previous.lastActionAt || '') : new Date().toISOString()
  }
  writeAudit(userDataPath, audit)
  return audit
}

export function getSensitiveLogDiagnostics(userDataPath: string, enabled: boolean): any {
  const path = logPath(userDataPath)
  const audit = readAudit(userDataPath)
  let currentBytes = 0
  let mode: string | null = null
  try {
    const stat = statSync(path)
    currentBytes = stat.size
    mode = (stat.mode & 0o777).toString(8).padStart(3, '0')
  } catch {}
  return {
    ...audit,
    enabled,
    currentBytes,
    mode,
    maxBytes: SENSITIVE_LOG_MAX_BYTES,
    retainBytes: SENSITIVE_LOG_RETAIN_BYTES,
    bounded: !enabled ? currentBytes === 0 : currentBytes <= SENSITIVE_LOG_MAX_BYTES,
    defaultPolicy: 'disabled_logs_are_empty'
  }
}
