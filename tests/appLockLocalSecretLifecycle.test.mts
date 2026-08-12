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
