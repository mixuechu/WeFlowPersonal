import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('legacy startup configuration migrates together into one local encrypted snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-startup-migration-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  writeFileSync(join(directory, 'WeFlow-config.json'), JSON.stringify({
    authEnabled: 'true',
    authPassword: 'legacy-password-hash',
    authUseHello: 'true',
    decryptKey: 'legacy-database-key',
    imageXorKey: 41,
    wxidConfigs: {
      wxid_legacy: { decryptKey: 'nested-key', imageAesKey: 'nested-image', imageXorKey: 57 }
    },
    aiModelApiKey: '',
    aiInsightApiKey: 'legacy-model-key',
    aiGroupSummaryFilterMode: 'blacklist',
    aiGroupSummaryFilterList: ['legacy-group']
  }))
  const { ConfigService } = await import('../electron/services/config.ts')
  ;(ConfigService as any).instance = undefined
  try {
    const config = new ConfigService()
    const persisted = JSON.parse(readFileSync(join(directory, 'WeFlow-config.json'), 'utf8'))
    for (const value of [
      persisted.authEnabled, persisted.authPassword, persisted.authUseHello,
      persisted.decryptKey, persisted.imageXorKey, persisted.aiModelApiKey, persisted.aiInsightApiKey,
      persisted.wxidConfigs.wxid_legacy.decryptKey,
      persisted.wxidConfigs.wxid_legacy.imageAesKey,
      persisted.wxidConfigs.wxid_legacy.imageXorKey
    ]) assert.match(value, /^local:v1:/)
    assert.doesNotMatch(JSON.stringify(persisted), /legacy-password-hash|legacy-database-key|nested-key|nested-image|legacy-model-key/)
    assert.equal(config.get('aiModelApiKey'), 'legacy-model-key')
    assert.equal(config.get('decryptKey'), 'legacy-database-key')
    assert.equal(config.get('wxidConfigs').wxid_legacy.imageXorKey, 57)
    assert.equal(persisted.aiGroupSummaryFilterMode, 'whitelist')
    assert.deepEqual(persisted.aiGroupSummaryFilterList, [])
  } finally {
    ;(ConfigService as any).instance = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})

test('startup migration builds one snapshot without field-by-field store writes', () => {
  const source = readFileSync(new URL('../electron/services/config.ts', import.meta.url), 'utf8')
  const body = source.slice(
    source.indexOf('private migrateStartupConfigurationAtomically()'),
    source.indexOf('// === 验证 ===')
  )
  assert.match(body, /structuredClone\(this\.store\.store/)
  assert.match(body, /if \(changed\) \(this\.store as any\)\.store = next/)
  assert.doesNotMatch(body, /this\.store\.set\(/)
  assert.doesNotMatch(body, /this\.set\(/)
})

test('one unreadable legacy Safe Storage value aborts the complete startup snapshot', () => {
  const source = readFileSync(new URL('../electron/services/config.ts', import.meta.url), 'utf8')
  const wrapper = source.slice(
    source.indexOf('private migrateStartupConfiguration(): void'),
    source.indexOf('private migrateStartupConfigurationAtomically()')
  )
  const body = source.slice(
    source.indexOf('private migrateStartupConfigurationAtomically()'),
    source.indexOf('// === 验证 ===')
  )
  assert.match(wrapper, /try[\s\S]*migrateStartupConfigurationAtomically\(\)[\s\S]*catch/)
  assert.match(body, /if \(!plaintext\) throw new Error\('旧 Safe Storage 值无法解密'\)/)
  assert.equal((body.match(/\(this\.store as any\)\.store = next/g) || []).length, 1)
})
