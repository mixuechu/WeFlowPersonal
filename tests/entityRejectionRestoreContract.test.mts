import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('rejected entity recovery is exposed through one authenticated IPC surface', () => {
  const preload = read('electron/preload.ts')
  const main = read('electron/main.ts')
  const types = read('src/types/electron.d.ts')
  for (const source of [preload, main, types]) {
    assert.match(source, /previewRestoreRejectedEntity/)
    assert.match(source, /restoreRejectedEntity/)
  }
})

test('resolved identity reviews expose a private-snapshot recovery preview and typed confirmation', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /review\.entityRejectionCascadeAvailable/)
  assert.match(page, /预览恢复范围/)
  assert.match(page, /entityRestoreConfirmation !== '恢复身份'/)
  assert.match(page, /当时自动关闭的.*旧候选继续保留为历史/s)
  assert.match(page, /因仍涉及其他未确认实体而保守恢复为候选/)
})

test('cascade snapshots are removed before review rows enter the renderer', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  assert.match(store, /delete payload\.entityRejectionCascadeSnapshot/)
  assert.match(store, /entityRejectionCascadeAvailable: Boolean\(rejectionCascadeSnapshot\)/)
  assert.match(store, /json_remove\(payload_json,'\$\.entityRejectionCascadeSnapshot'\)/)
})

test('entity rejection scopes all related memories in SQL instead of a bounded dashboard feed', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  assert.match(service, /listEntityMemoryStatusRefs\(entity\.id\)/)
  assert.doesNotMatch(service, /const connectedClaims = \(feed\.claims/)
  assert.match(store, /FROM claims\s+WHERE subject_id=\? OR object_entity_id=\?/s)
  assert.match(store, /FROM events event\s+WHERE EXISTS/s)
  assert.match(service, /entityIds: memory\.entityIds/)
})

test('restore computes one fail-closed plan before opening its reversible mutation', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const policy = read('electron/services/entityRejectionRestorePolicy.ts')
  const planAt = service.indexOf('const restorePlan = buildEntityRejectionRestorePlan')
  const mutationAt = service.indexOf('return runReversibleGraphMutation({', planAt)
  assert.ok(planAt >= 0 && mutationAt > planAt)
  assert.match(policy, /throw new Error\(`关联关系 \$\{expected\.id\} 已变化，不能生成身份恢复计划`\)/)
  assert.match(service, /for \(const planned of restorePlan\.relations\)/)
  assert.match(service, /for \(const planned of restorePlan\.memories\)/)
})
