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
  recoverInterruptedMemoryBackupTrash,
  rollbackStagedMemoryBackupTrash,
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
