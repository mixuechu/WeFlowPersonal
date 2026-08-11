import assert from 'node:assert/strict'
import test from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  inspectMemoryBackupTrashConflict,
  listMemoryBackupTrashConflicts,
  recoverInterruptedMemoryBackupTrash,
  rollbackStagedMemoryBackupTrash,
  stageMemoryArtifactsTrash,
  stageMemoryBackupTrash
} from '../electron/services/memoryBackupTrashPolicy.ts'

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-backup-trash-'))
  try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('backup trash staging moves database and state as one recoverable group', () => withDirectory(directory => {
  const databasePath = join(directory, 'personal-memory-pair.sqlite')
  const statePath = `${databasePath}.state.json`
  writeFileSync(databasePath, 'database')
  writeFileSync(statePath, 'state')
  const stagingDirectory = join(directory, '.weflow-backup-trash-a1')
  const staged = stageMemoryBackupTrash({
    databasePath,
    hasState: true,
    stagingDirectory
  })

  assert.equal(staged.artifacts.length, 2)
  assert.equal(existsSync(databasePath), false)
  assert.equal(existsSync(statePath), false)
  assert.equal(rollbackStagedMemoryBackupTrash(staged), true)
  assert.equal(readFileSync(databasePath, 'utf8'), 'database')
  assert.equal(readFileSync(statePath, 'utf8'), 'state')
  assert.equal(existsSync(stagingDirectory), false)
}))

test('backup trash startup recovery restores interrupted groups and preserves conflicts', () => withDirectory(directory => {
  const recoverable = join(directory, '.weflow-backup-trash-b2')
  mkdirSync(recoverable)
  writeFileSync(join(recoverable, 'personal-memory-recover.sqlite'), 'database')
  writeFileSync(join(recoverable, 'personal-memory-recover.sqlite.state.json'), 'state')
  const conflict = join(directory, '.weflow-backup-trash-c3')
  mkdirSync(conflict)
  writeFileSync(join(conflict, 'personal-memory-conflict.sqlite'), 'staged')
  writeFileSync(join(directory, 'personal-memory-conflict.sqlite'), 'current')

  assert.deepEqual(recoverInterruptedMemoryBackupTrash(directory), {
    checked: 2,
    restored: 1,
    conflicts: 1
  })
  assert.equal(readFileSync(join(directory, 'personal-memory-recover.sqlite'), 'utf8'), 'database')
  assert.equal(readFileSync(
    join(directory, 'personal-memory-recover.sqlite.state.json'),
    'utf8'
  ), 'state')
  assert.equal(existsSync(recoverable), false)
  assert.equal(readFileSync(join(conflict, 'personal-memory-conflict.sqlite'), 'utf8'), 'staged')
}))

test('import staging conflicts move as one group and restart recovery restores every artifact', () => withDirectory(directory => {
  const databaseStaging = join(
    directory,
    'personal-memory-imported-interrupted.sqlite.importing-db'
  )
  const stateStaging = join(
    directory,
    'personal-memory-imported-interrupted.sqlite.importing-state'
  )
  writeFileSync(databaseStaging, 'database-staging')
  writeFileSync(stateStaging, 'state-staging')
  const stagingDirectory = join(directory, '.weflow-backup-trash-d4')
  const staged = stageMemoryArtifactsTrash({
    artifactPaths: [databaseStaging, stateStaging],
    stagingDirectory
  })

  assert.equal(staged.artifacts.length, 2)
  assert.equal(existsSync(databaseStaging), false)
  assert.equal(existsSync(stateStaging), false)
  assert.deepEqual(recoverInterruptedMemoryBackupTrash(directory), {
    checked: 1,
    restored: 1,
    conflicts: 0
  })
  assert.equal(readFileSync(databaseStaging, 'utf8'), 'database-staging')
  assert.equal(readFileSync(stateStaging, 'utf8'), 'state-staging')
}))

test('trash conflicts expose safe restore direction without overwriting an occupied target', () => withDirectory(directory => {
  const stagingDirectory = join(directory, '.weflow-backup-trash-e5')
  mkdirSync(stagingDirectory)
  const name = 'personal-memory-collision.sqlite'
  writeFileSync(join(stagingDirectory, name), 'staged-database')
  writeFileSync(join(directory, name), 'current-database')

  const [blocked] = listMemoryBackupTrashConflicts(directory)
  assert.equal(blocked.reason, 'target_conflict')
  assert.equal(blocked.targetConflictCount, 1)
  assert.equal(blocked.canRestore, false)
  assert.equal(blocked.canDiscard, true)
  assert.match(blocked.id, /^[a-f0-9]{64}$/)
  assert.equal(inspectMemoryBackupTrashConflict(directory, blocked.id).identity, blocked.identity)
  assert.equal(readFileSync(join(directory, name), 'utf8'), 'current-database')

  rmSync(join(directory, name))
  const [restorable] = listMemoryBackupTrashConflicts(directory)
  assert.equal(restorable.reason, 'restore_retry')
  assert.equal(restorable.canRestore, true)
  assert.equal(rollbackStagedMemoryBackupTrash({
    stagingDirectory,
    artifacts: restorable.artifacts.map(item => ({
      source: item.source,
      staged: item.staged
    }))
  }), true)
  assert.equal(readFileSync(join(directory, name), 'utf8'), 'staged-database')
}))

test('trash conflict automation fails closed for nested or non-file artifacts', () => withDirectory(directory => {
  const stagingDirectory = join(directory, '.weflow-backup-trash-f6')
  mkdirSync(stagingDirectory)
  mkdirSync(join(stagingDirectory, 'unexpected-directory'))

  const [conflict] = listMemoryBackupTrashConflicts(directory)
  assert.equal(conflict.reason, 'invalid_artifact')
  assert.equal(conflict.invalidArtifactCount, 1)
  assert.equal(conflict.canRestore, false)
  assert.equal(conflict.canDiscard, false)
}))
