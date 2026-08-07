export function createJointMemoryBackup<T extends {
  path: string
  retained?: number
}>(input: {
  createDatabaseBackup: () => T
  writeStateBackup: (stateBackupPath: string) => void
  finalizeRetention: () => number
  removeArtifact: (path: string) => void
}): T & { stateBackupPath: string; retained: number } {
  const databaseBackup = input.createDatabaseBackup()
  const stateBackupPath = `${databaseBackup.path}.state.json`
  try {
    input.writeStateBackup(stateBackupPath)
  } catch (error) {
    try { input.removeArtifact(stateBackupPath) } catch {}
    try { input.removeArtifact(databaseBackup.path) } catch {}
    throw error
  }
  const retained = input.finalizeRetention()
  return { ...databaseBackup, stateBackupPath, retained }
}

export type JointMemoryBackupRestoreAssessment = {
  restorable: boolean
  reason: 'ok' | 'database_invalid' | 'database_unencrypted' | 'state_invalid' | 'state_unencrypted'
}

export function inspectJointMemoryBackupRestorability(input: {
  backupPath: string
  inspectDatabase: (path: string) => {
    integrity?: string
    encrypted?: boolean
  }
  inspectState: (path: string) => {
    recoverySource?: string
    encrypted?: boolean
  }
}): JointMemoryBackupRestoreAssessment {
  try {
    const database = input.inspectDatabase(input.backupPath)
    if (database.integrity !== 'ok') {
      return { restorable: false, reason: 'database_invalid' }
    }
    if (database.encrypted !== true) {
      return { restorable: false, reason: 'database_unencrypted' }
    }
  } catch {
    return { restorable: false, reason: 'database_invalid' }
  }
  try {
    const state = input.inspectState(`${input.backupPath}.state.json`)
    if (state.recoverySource === 'empty') {
      return { restorable: false, reason: 'state_invalid' }
    }
    if (state.encrypted !== true) {
      return { restorable: false, reason: 'state_unencrypted' }
    }
    return { restorable: true, reason: 'ok' }
  } catch {
    return { restorable: false, reason: 'state_invalid' }
  }
}

export function isJointMemoryBackupRestorable(
  input: Parameters<typeof inspectJointMemoryBackupRestorability>[0]
): boolean {
  return inspectJointMemoryBackupRestorability(input).restorable
}

export type JointMemoryBackupValidationCache = Map<string, {
  fingerprint: string
  assessment: JointMemoryBackupRestoreAssessment
}>

export function auditJointMemoryBackupInventory(input: {
  backups: Array<{ path: string; hasState: boolean }>
  fingerprint: (backup: { path: string; hasState: boolean }) => string
  inspect: (backupPath: string) => JointMemoryBackupRestoreAssessment
  cache: JointMemoryBackupValidationCache
}): {
  version: string
  paired: number
  restorable: number
  invalid: number
  databaseInvalid: number
  databaseUnencrypted: number
  stateInvalid: number
  stateUnencrypted: number
  validatedNow: number
  reusedFromCache: number
} {
  const currentPaths = new Set(input.backups.map(backup => backup.path))
  for (const path of input.cache.keys()) {
    if (!currentPaths.has(path)) input.cache.delete(path)
  }
  const assessments: JointMemoryBackupRestoreAssessment[] = []
  let validatedNow = 0
  let reusedFromCache = 0
  for (const backup of input.backups.filter(item => item.hasState)) {
    const fingerprint = input.fingerprint(backup)
    const cached = input.cache.get(backup.path)
    if (cached?.fingerprint === fingerprint) {
      reusedFromCache += 1
      assessments.push(cached.assessment)
      continue
    }
    const assessment = input.inspect(backup.path)
    input.cache.set(backup.path, { fingerprint, assessment })
    assessments.push(assessment)
    validatedNow += 1
  }
  const count = (reason: JointMemoryBackupRestoreAssessment['reason']) =>
    assessments.filter(item => item.reason === reason).length
  const restorable = count('ok')
  return {
    version: 'joint-backup-restore-audit-v1',
    paired: assessments.length,
    restorable,
    invalid: assessments.length - restorable,
    databaseInvalid: count('database_invalid'),
    databaseUnencrypted: count('database_unencrypted'),
    stateInvalid: count('state_invalid'),
    stateUnencrypted: count('state_unencrypted'),
    validatedNow,
    reusedFromCache
  }
}
