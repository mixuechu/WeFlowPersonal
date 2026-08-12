import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('missing local master key is recovered atomically from its private replica', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-local-key-recovery-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  try {
    const first = new ConfigService()
    first.set('aiAssistantApiKey', 'recovery-secret')
    const keyPath = join(directory, 'secrets', 'local-master-key.bin')
    const backupPath = join(directory, 'secrets', 'local-master-key.recovery.bin')
    assert.deepEqual(readFileSync(keyPath), readFileSync(backupPath))
    rmSync(keyPath)
    ;(ConfigService as any).instance = undefined
    const recovered = new ConfigService()
    assert.equal(recovered.get('aiAssistantApiKey'), 'recovery-secret')
    assert.equal(recovered.getLocalSecretStorageStatus().recoveredThisStart, true)
    assert.equal(recovered.getLocalSecretStorageStatus().backupAvailable, true)
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})

test('corrupted primary key is preserved and never overwritten from the recovery replica', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-local-key-corrupt-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  ;(ConfigService as any).instance = undefined
  try {
    const first = new ConfigService()
    first.set('aiAssistantApiKey', 'preserve-secret')
    const keyPath = join(directory, 'secrets', 'local-master-key.bin')
    writeFileSync(keyPath, Buffer.alloc(31, 7))
    ;(ConfigService as any).instance = undefined
    const reopened = new ConfigService()
    assert.equal(reopened.isLocalSecretStorageAvailable(), false)
    assert.match(reopened.getLocalSecretStorageStatus().recoveryError, /损坏/)
    assert.equal(readFileSync(keyPath).length, 31)
    assert.equal(reopened.get('aiAssistantApiKey'), '')
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})

test('missing primary and replica fail closed when encrypted configuration already exists', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-local-key-both-missing-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  ;(ConfigService as any).instance = undefined
  try {
    const first = new ConfigService()
    first.set('aiAssistantApiKey', 'must-not-overwrite')
    const keyPath = join(directory, 'secrets', 'local-master-key.bin')
    const backupPath = join(directory, 'secrets', 'local-master-key.recovery.bin')
    rmSync(keyPath)
    rmSync(backupPath)
    ;(ConfigService as any).instance = undefined
    const reopened = new ConfigService()
    assert.equal(reopened.isLocalSecretStorageAvailable(), false)
    assert.match(reopened.getLocalSecretStorageStatus().recoveryError, /均缺失/)
    assert.equal(reopened.get('aiAssistantApiKey'), '')
    assert.equal(readFileSync(join(directory, 'WeFlow-config.json'), 'utf8').includes('local:v1:'), true)
    assert.throws(() => readFileSync(keyPath))
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})
