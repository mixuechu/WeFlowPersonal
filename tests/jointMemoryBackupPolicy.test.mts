import assert from 'node:assert/strict'
import test from 'node:test'
import { createJointMemoryBackup } from '../electron/services/jointMemoryBackupPolicy.ts'

test('joint memory backup retains only after both database and state artifacts exist', () => {
  const order: string[] = []
  const result = createJointMemoryBackup({
    createDatabaseBackup: () => {
      order.push('database')
      return { path: '/private/memory.sqlite', bytes: 42, retained: 11 }
    },
    writeStateBackup: path => {
      order.push(`state:${path}`)
    },
    finalizeRetention: () => {
      order.push('retention')
      return 10
    },
    removeArtifact: path => {
      order.push(`remove:${path}`)
    }
  })
  assert.deepEqual(order, [
    'database',
    'state:/private/memory.sqlite.state.json',
    'retention'
  ])
  assert.deepEqual(result, {
    path: '/private/memory.sqlite',
    bytes: 42,
    stateBackupPath: '/private/memory.sqlite.state.json',
    retained: 10
  })
})

test('joint memory backup removes both artifacts and preserves retention on state failure', () => {
  const removed: string[] = []
  let finalized = false
  assert.throws(() => createJointMemoryBackup({
    createDatabaseBackup: () => ({ path: '/private/incomplete.sqlite' }),
    writeStateBackup: () => {
      throw new Error('injected state snapshot failure')
    },
    finalizeRetention: () => {
      finalized = true
      return 10
    },
    removeArtifact: path => {
      removed.push(path)
      if (path.endsWith('.state.json')) throw new Error('missing partial sidecar')
    }
  }), /injected state snapshot failure/)
  assert.equal(finalized, false)
  assert.deepEqual(removed, [
    '/private/incomplete.sqlite.state.json',
    '/private/incomplete.sqlite'
  ])
})
