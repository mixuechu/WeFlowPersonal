import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'

export type StagedMemoryBackupTrash = {
  stagingDirectory: string
  artifacts: Array<{ source: string; staged: string }>
}

export type MemoryBackupTrashConflict = {
  id: string
  stagingDirectory: string
  artifacts: Array<{
    name: string
    staged: string
    source: string
    bytes: number
    mtimeMs: number
    ctimeMs: number
    regularFile: boolean
    validName: boolean
    targetExists: boolean
  }>
  artifactCount: number
  bytes: number
  detectedAt: string
  invalidArtifactCount: number
  targetConflictCount: number
  canRestore: boolean
  canDiscard: boolean
  reason: 'target_conflict' | 'invalid_artifact' | 'restore_retry'
  identity: string
}

const VALID_BACKUP_ARTIFACT =
  /^personal-memory-.*\.sqlite(?:\.state\.json|\.importing-(?:db|state))?$/
const TRASH_STAGING_DIRECTORY = /^\.weflow-backup-trash-[a-f0-9-]+$/i

export function listMemoryBackupTrashConflicts(
  backupDirectory: string
): MemoryBackupTrashConflict[] {
  let stagingNames: string[] = []
  try {
    stagingNames = readdirSync(backupDirectory).filter(name =>
      TRASH_STAGING_DIRECTORY.test(name))
  } catch { return [] }
  return stagingNames.sort().map(stagingName => {
    const stagingDirectory = join(backupDirectory, stagingName)
    let artifactNames: string[] = []
    try { artifactNames = readdirSync(stagingDirectory).sort() } catch { return null }
    const artifacts = artifactNames.map(name => {
      const staged = join(stagingDirectory, name)
      const source = join(backupDirectory, name)
      try {
        const lstat = lstatSync(staged)
        const stat = lstat.isSymbolicLink() ? lstat : statSync(staged)
        return {
          name,
          staged,
          source,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
          regularFile: lstat.isFile(),
          validName: VALID_BACKUP_ARTIFACT.test(name),
          targetExists: existsSync(source)
        }
      } catch {
        return {
          name,
          staged,
          source,
          bytes: 0,
          mtimeMs: 0,
          ctimeMs: 0,
          regularFile: false,
          validName: false,
          targetExists: existsSync(source)
        }
      }
    })
    const invalidArtifactCount = artifacts.filter(item =>
      !item.validName || !item.regularFile).length
    const targetConflictCount = artifacts.filter(item => item.targetExists).length
    const detectedMs = Math.max(0, ...artifacts.map(item => Math.max(item.mtimeMs, item.ctimeMs)))
    const identity = createHash('sha256').update(JSON.stringify(artifacts.map(item => [
      item.name,
      item.bytes,
      item.mtimeMs,
      item.ctimeMs,
      item.regularFile,
      item.validName,
      item.targetExists
    ]))).digest('hex')
    return {
      id: createHash('sha256').update(`memory-backup-trash:${stagingName}`).digest('hex'),
      stagingDirectory,
      artifacts,
      artifactCount: artifacts.length,
      bytes: artifacts.reduce((sum, item) => sum + item.bytes, 0),
      detectedAt: detectedMs ? new Date(detectedMs).toISOString() : '',
      invalidArtifactCount,
      targetConflictCount,
      canRestore: artifacts.length > 0 && invalidArtifactCount === 0 && targetConflictCount === 0,
      canDiscard: artifacts.length > 0 && artifacts.every(item => item.regularFile),
      reason: invalidArtifactCount > 0
        ? 'invalid_artifact'
        : targetConflictCount > 0
          ? 'target_conflict'
          : 'restore_retry',
      identity
    }
  }).filter((item): item is MemoryBackupTrashConflict => Boolean(item))
}

export function inspectMemoryBackupTrashConflict(
  backupDirectory: string,
  id: string
): MemoryBackupTrashConflict {
  const normalizedId = String(id || '').trim()
  if (!/^[a-f0-9]{64}$/.test(normalizedId)) throw new Error('快照安全暂存冲突身份无效')
  const conflict = listMemoryBackupTrashConflicts(backupDirectory)
    .find(item => item.id === normalizedId)
  if (!conflict) throw new Error('该快照安全暂存冲突已经变化或不存在，请刷新诊断')
  return conflict
}

export function rollbackStagedMemoryBackupTrash(
  staged: StagedMemoryBackupTrash
): boolean {
  let restored = true
  for (const artifact of staged.artifacts.slice().reverse()) {
    try {
      if (existsSync(artifact.staged) && !existsSync(artifact.source)) {
        renameSync(artifact.staged, artifact.source)
      }
    } catch {
      restored = false
    }
  }
  try { rmdirSync(staged.stagingDirectory) } catch {
    if (existsSync(staged.stagingDirectory)) restored = false
  }
  return restored
}

export function stageMemoryBackupTrash(input: {
  databasePath: string
  hasState: boolean
  stagingDirectory: string
}): StagedMemoryBackupTrash {
  const statePath = `${input.databasePath}.state.json`
  return stageMemoryArtifactsTrash({
    artifactPaths: [input.databasePath, ...(input.hasState ? [statePath] : [])],
    stagingDirectory: input.stagingDirectory
  })
}

export function stageMemoryArtifactsTrash(input: {
  artifactPaths: string[]
  stagingDirectory: string
}): StagedMemoryBackupTrash {
  const artifactPaths = [...new Set(input.artifactPaths)]
  if (!artifactPaths.length) throw new Error('没有可移到废纸篓的个人记忆文件')
  const names = artifactPaths.map(path => basename(path))
  if (new Set(names).size !== names.length) throw new Error('个人记忆文件名称冲突，未执行清理')
  const artifacts = artifactPaths.map((source, index) => ({
    source,
    staged: join(input.stagingDirectory, names[index])
  }))
  mkdirSync(input.stagingDirectory, { mode: 0o700 })
  const moved: StagedMemoryBackupTrash = {
    stagingDirectory: input.stagingDirectory,
    artifacts: []
  }
  try {
    for (const artifact of artifacts) {
      renameSync(artifact.source, artifact.staged)
      moved.artifacts.push(artifact)
    }
    return moved
  } catch (error) {
    if (!rollbackStagedMemoryBackupTrash(moved)) {
      throw new Error('快照暂存失败且自动回滚未完全成功；重启应用会再次恢复')
    }
    throw error
  }
}

export function recoverInterruptedMemoryBackupTrash(
  backupDirectory: string
): {
  checked: number
  restored: number
  conflicts: number
} {
  let stagingNames: string[] = []
  try {
    stagingNames = readdirSync(backupDirectory).filter(name =>
      TRASH_STAGING_DIRECTORY.test(name))
  } catch {}
  let checked = 0
  let restored = 0
  let conflicts = 0
  for (const stagingName of stagingNames) {
    const stagingDirectory = join(backupDirectory, stagingName)
    let artifactNames: string[] = []
    try { artifactNames = readdirSync(stagingDirectory) } catch { continue }
    checked += 1
    const validNames = artifactNames.filter(name =>
      VALID_BACKUP_ARTIFACT.test(name))
    if (validNames.length !== artifactNames.length ||
        validNames.some(name => existsSync(join(backupDirectory, name)))) {
      conflicts += 1
      continue
    }
    const staged: StagedMemoryBackupTrash = {
      stagingDirectory,
      artifacts: validNames.map(name => ({
        source: join(backupDirectory, name),
        staged: join(stagingDirectory, name)
      }))
    }
    if (rollbackStagedMemoryBackupTrash(staged)) restored += 1
    else conflicts += 1
  }
  return { checked, restored, conflicts }
}
