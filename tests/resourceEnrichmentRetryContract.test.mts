import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const service = read('electron/services/aiAssistantService.ts')
const store = read('electron/services/personalMemoryStore.ts')
const main = read('electron/main.ts')
const preload = read('electron/preload.ts')
const page = read('src/pages/AiAssistantPage.tsx')

test('single-resource enrichment retry is identity-bound and owns the writer gate', () => {
  assert.match(store, /retryToken: createHash\('sha256'\)/)
  assert.match(store, /resourceId = ''/)
  assert.match(store, /\(\?='' OR r\.id=\?\)/)
  assert.match(service, /async retryResourceEnrichment/)
  assert.match(service, /current\.enrichment\?\.retryToken !== retryToken/)
  assert.match(service, /describeBackgroundWriteState/)
  assert.match(service, /this\.resourceEnrichmentPromise = tracked/)
  assert.match(service, /new Date\('9999-12-31T23:59:59\.999Z'\)/)
  assert.match(main, /ai-assistant:retryResourceEnrichment/)
  assert.match(preload, /retryResourceEnrichment/)
})

test('resource cards explain disabled capabilities and refresh after one retry', () => {
  assert.match(page, /resourceEnrichmentDisabledReason/)
  assert.match(page, /立即重试这一条/)
  assert.match(page, /忽略当前冷却时间，只重试这一条资源/)
  assert.match(page, /retryResourceEnrichment\(\{/)
  assert.match(page, /retryToken: enrichment\.retryToken/)
  assert.match(page, /setResourceRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /AI 助理总开关已关闭/)
  assert.match(page, /网页正文索引当前未启用/)
})
