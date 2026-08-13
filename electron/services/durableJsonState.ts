import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'

export type DurableJsonRecovery = {
  source: 'primary' | 'backup' | 'empty'
  recovered: boolean
  repairedPrimary: boolean
  primaryError: string
  backupError: string
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function writeSyncedFile(path: string, content: string): void {
  const descriptor = openSync(path, 'w', 0o600)
  try {
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try { chmodSync(path, 0o600) } catch {}
}

function parseFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeDurableJson(path: string, value: unknown): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  const backup = `${path}.bak`
  const backupTemporary = `${backup}.tmp`
  const content = `${JSON.stringify(value, null, 2)}\n`
  try {
    writeSyncedFile(temporary, content)
    if (existsSync(path)) {
      try {
        const current = readFileSync(path, 'utf8')
        JSON.parse(current)
        writeSyncedFile(backupTemporary, current)
        renameSync(backupTemporary, backup)
      } catch {
        try { unlinkSync(backupTemporary) } catch {}
      }
    }
    renameSync(temporary, path)
    syncDirectory(directory)
  } catch (error) {
    try { unlinkSync(temporary) } catch {}
    try { unlinkSync(backupTemporary) } catch {}
    throw error
  }
}

export function readDurableJson<T>(path: string, fallback: T): {
  value: T
  recovery: DurableJsonRecovery
} {
  let primaryError = ''
  let backupError = ''
  try {
    return {
      value: parseFile<T>(path),
      recovery: {
        source: 'primary',
        recovered: false,
        repairedPrimary: false,
        primaryError,
        backupError
      }
    }
  } catch (error) {
    primaryError = existsSync(path) ? String(error) : 'missing'
  }
  const backup = `${path}.bak`
  try {
    const value = parseFile<T>(backup)
    let repairedPrimary = false
    try {
      writeDurableJson(path, value)
      repairedPrimary = true
    } catch {}
    return {
      value,
      recovery: {
        source: 'backup',
        recovered: true,
        repairedPrimary,
        primaryError,
        backupError
      }
    }
  } catch (error) {
    backupError = existsSync(backup) ? String(error) : 'missing'
  }
  return {
    value: fallback,
    recovery: {
      source: 'empty',
      recovered: false,
      repairedPrimary: false,
      primaryError,
      backupError
    }
  }
}
