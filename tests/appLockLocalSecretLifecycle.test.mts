import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('application lock survives local-secret restart, password change and disable without losing WeChat keys', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-app-lock-local-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  try {
    const config = new ConfigService()
    config.setMany({
      decryptKey: 'database-secret',
      imageAesKey: 'image-secret',
      imageXorKey: 73,
      wxidConfigs: {
        wxid_one: { decryptKey: 'account-db', imageAesKey: 'account-image', imageXorKey: 91, updatedAt: 1 }
      }
    })
    assert.equal(config.enableLock('first-password').success, true)
    assert.equal(config.verifyAuthEnabled(), true)
    let persisted = JSON.parse(readFileSync(join(directory, 'WeFlow-config.json'), 'utf8'))
    assert.match(persisted.authEnabled, /^local:v1:/)
    assert.match(persisted.authPassword, /^local:v1:/)
    assert.match(persisted.decryptKey, /^lock:/)
    assert.equal(config.unlock('wrong-password').error, '密码错误')

    ;(ConfigService as any).instance = undefined
    const reopened = new ConfigService()
    assert.equal(reopened.verifyAuthEnabled(), true)
    assert.equal(reopened.unlock('first-password').success, true)
    assert.equal(reopened.get('decryptKey'), 'database-secret')
    assert.equal(reopened.get('imageAesKey'), 'image-secret')
    assert.equal(reopened.get('imageXorKey'), 73)
    assert.deepEqual(reopened.get('wxidConfigs').wxid_one, {
      decryptKey: 'account-db', imageAesKey: 'account-image', imageXorKey: 91, updatedAt: 1
    })

    assert.equal(reopened.changePassword('first-password', 'second-password').success, true)
    ;(ConfigService as any).instance = undefined
    const changed = new ConfigService()
    assert.equal(changed.unlock('first-password').success, false)
    assert.equal(changed.unlock('second-password').success, true)
    assert.equal(changed.disableLock('second-password').success, true)
    assert.equal(changed.verifyAuthEnabled(), false)
    persisted = JSON.parse(readFileSync(join(directory, 'WeFlow-config.json'), 'utf8'))
    assert.match(persisted.decryptKey, /^local:v1:/)
    assert.equal(persisted.authPassword, '')
    assert.equal(changed.get('decryptKey'), 'database-secret')
    assert.equal(changed.get('wxidConfigs').wxid_one.decryptKey, 'account-db')
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})

test('application lock rejects corrupted encrypted fields without committing partial unlock state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-app-lock-corrupt-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  ;(ConfigService as any).instance = undefined
  try {
    const config = new ConfigService()
    config.setMany({ decryptKey: 'database-secret', imageAesKey: 'image-secret' })
    assert.equal(config.enableLock('correct-password').success, true)
    const raw = (config as any).store.get('imageAesKey') as string
    const offset = 'lock:'.length + 20
    ;(config as any).store.set('imageAesKey', raw.slice(0, offset) + (raw[offset] === 'A' ? 'B' : 'A') + raw.slice(offset + 1))
    ;(config as any).unlockedKeys.clear()
    ;(config as any).unlockPassword = null
    const result = config.unlock('correct-password')
    assert.equal(result.success, false)
    assert.match(result.error || '', /加密数据校验失败/)
    assert.equal((config as any).unlockedKeys.size, 0)
    assert.equal((config as any).unlockPassword, null)
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})

test('application lock transitions use one durable commit and publish runtime state only after success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-app-lock-atomic-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  ;(ConfigService as any).instance = undefined
  try {
    const config = new ConfigService()
    config.setMany({ decryptKey: 'atomic-secret', imageXorKey: 17 })
    const configPath = join(directory, 'WeFlow-config.json')
    const before = readFileSync(configPath, 'utf8')
    const originalStore = (config as any).store
    ;(config as any).store = {
      get: originalStore.get.bind(originalStore),
      set: originalStore.set.bind(originalStore),
      get store() { return originalStore.store },
      set store(_value: unknown) { throw new Error('injected atomic commit failure') }
    }
    const failed = config.enableLock('atomic-password')
    assert.equal(failed.success, false)
    assert.match(failed.error || '', /injected atomic commit failure/)
    assert.equal(readFileSync(configPath, 'utf8'), before)
    assert.equal((config as any).unlockPassword, null)
    assert.equal((config as any).unlockedKeys.size, 0)

    ;(config as any).store = originalStore
    let commits = 0
    ;(config as any).commitStoredValues = function (values: unknown) {
      commits += 1
      const next = { ...originalStore.store, ...(values as object) }
      originalStore.store = next
    }
    assert.equal(config.enableLock('atomic-password').success, true)
    assert.equal(commits, 1)
    assert.equal(config.changePassword('atomic-password', 'changed-password').success, true)
    assert.equal(commits, 2)
    config.setHelloSecret('changed-password')
    assert.equal(commits, 3)
    config.clearHelloSecret()
    assert.equal(commits, 4)
    assert.equal(config.disableLock('changed-password').success, true)
    assert.equal(commits, 5)
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})
