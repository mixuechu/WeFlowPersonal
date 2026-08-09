import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WcdbService, WCDB_MAX_PENDING_REQUESTS } from '../electron/services/wcdbService.ts'

const root = process.cwd()

test('WCDB admission is bounded while the ordered close keeps a reserved path', () => {
  const source = readFileSync(join(root, 'electron/services/wcdbService.ts'), 'utf8')
  assert.equal(WCDB_MAX_PENDING_REQUESTS, 256)
  assert.match(source, /type !== 'close' && this\.pending\.size >= WCDB_MAX_PENDING_REQUESTS/)
  assert.match(source, /queueRejectedCount \+= 1/)
  assert.match(source, /queueHighWatermark = Math\.max/)
  assert.match(source, /getQueueHealth\(\)/)
})

test('WCDB admission rejects the first over-capacity RPC but still accepts close', async () => {
  const service = new WcdbService() as any
  const sent: Array<{ type: string }> = []
  service.worker = { postMessage: (message: { type: string }) => sent.push(message) }
  const accepted = Array.from({ length: WCDB_MAX_PENDING_REQUESTS }, (_, index) =>
    service.callWorker(`fixture-${index}`))
  assert.equal(accepted.length, WCDB_MAX_PENDING_REQUESTS)
  await assert.rejects(service.callWorker('overflow'), /请求队列已达到 256 项/)
  const close = service.callWorker('close')
  assert.ok(close instanceof Promise)
  assert.equal(sent.length, WCDB_MAX_PENDING_REQUESTS + 1)
  assert.equal(sent.at(-1)?.type, 'close')
  assert.deepEqual(service.getQueueHealth(), {
    pending: WCDB_MAX_PENDING_REQUESTS + 1,
    capacity: WCDB_MAX_PENDING_REQUESTS,
    highWatermark: WCDB_MAX_PENDING_REQUESTS + 1,
    rejectedCount: 1,
    lastRejectedAt: service.getQueueHealth().lastRejectedAt,
    lastRejectedType: 'overflow'
  })
  assert.match(service.getQueueHealth().lastRejectedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('export quote hydration deduplicates ids and submits only eight WCDB calls at once', () => {
  const source = readFileSync(join(root, 'electron/services/export/core/ExportContext.ts'), 'utf8')
  const method = source.match(/public async resolveQuotedMessagesForExport[\s\S]*?\n    public /)?.[0] || ''
  assert.match(method, /uniqueSvrids = \[\.\.\.new Set/)
  assert.match(method, /const chunkSize = 8/)
  assert.match(method, /uniqueSvrids\.slice\(offset, offset \+ chunkSize\)/)
  assert.doesNotMatch(method, /svridsToResolve\.map\([^\n]*wcdbService/)
})

test('bounded WCDB queue health is visible in full diagnostics', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')
  assert.match(service, /wcdbQueue: wcdbService\.getQueueHealth\(\)/)
  assert.match(page, /微信数据库请求队列/)
  assert.match(page, /累计背压/)
  assert.match(page, /安全关闭请求始终保留入口/)
})
