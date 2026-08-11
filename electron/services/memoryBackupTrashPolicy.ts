import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync
} from 'node:fs'
import { basename, join } from 'node:path'

export type StagedMemoryBackupTrash = {
  stagingDirectory: string
  artifacts: Array<{ source: string; staged: string }>
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
      /^\.weflow-backup-trash-[a-f0-9-]+$/i.test(name))
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
      /^personal-memory-.*\.sqlite(?:\.state\.json|\.importing-(?:db|state))?$/.test(name))
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
