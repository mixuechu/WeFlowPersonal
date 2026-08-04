import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('config batch commit persists all assistant settings in one store replacement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-config-batch-'))
  process.env.WEFLOW_WORKER = '1'
  process.env.WEFLOW_CONFIG_CWD = directory
  const { ConfigService } = await import('../electron/services/config.ts')
  const config = new ConfigService()
  config.setMany({
    aiAssistantEnabled: false,
    aiAssistantOwnerName: '批量设置用户',
    aiAssistantSensitiveRedactionLevel: 'strict',
    aiAssistantApiKey: 'sk-batch-secret'
  })
  assert.equal(config.get('aiAssistantEnabled'), false)
  assert.equal(config.get('aiAssistantOwnerName'), '批量设置用户')
  assert.equal(config.get('aiAssistantSensitiveRedactionLevel'), 'strict')
  assert.equal(config.get('aiAssistantApiKey'), 'sk-batch-secret')
  const persisted = readFileSync(join(directory, 'WeFlow-config.json'), 'utf8')
  assert.match(persisted, /批量设置用户/)
  assert.match(persisted, /strict/)
  const before = config.get('aiAssistantOwnerName')
  assert.throws(() => config.setMany({
    aiAssistantOwnerName: '不应保存',
    someCacheMap: { unsafe: true }
  } as any), /不支持旁路缓存字段/)
  assert.equal(config.get('aiAssistantOwnerName'), before)
  rmSync(directory, { recursive: true, force: true })
})
