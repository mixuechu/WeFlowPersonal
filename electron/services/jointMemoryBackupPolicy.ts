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

export function isJointMemoryBackupRestorable(input: {
  backupPath: string
  inspectDatabase: (path: string) => {
    integrity?: string
    encrypted?: boolean
  }
  inspectState: (path: string) => {
    recoverySource?: string
    encrypted?: boolean
  }
}): boolean {
  try {
    const database = input.inspectDatabase(input.backupPath)
    if (database.integrity !== 'ok' || database.encrypted !== true) return false
    const state = input.inspectState(`${input.backupPath}.state.json`)
    return state.recoverySource !== 'empty' && state.encrypted === true
  } catch {
    return false
  }
}
