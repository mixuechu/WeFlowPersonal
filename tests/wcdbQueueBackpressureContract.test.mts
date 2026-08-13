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
    currentlyBackpressured: true,
    highWatermark: WCDB_MAX_PENDING_REQUESTS + 1,
    rejectedCount: 1,
    lastRejectedAt: service.getQueueHealth().lastRejectedAt,
    lastRejectedType: 'overflow',
    monitorDelivery: {
      failures: 0,
      lastErrorAt: '',
      lastError: '',
      lastSuccessAt: ''
    },
    workerLifecycle: {
      unexpectedExitCount: 0,
      lastExitAt: '',
      lastExitCode: null,
      lastExitRejectedRequests: 0,
      awaitingRestart: false,
      workerActive: true
    }
  })
  assert.match(service.getQueueHealth().lastRejectedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('an unexpected zero-code worker exit rejects every pending request and permits restart', async () => {
  const service = new WcdbService() as any
  service.worker = { marker: 'old-worker' }
  const first = new Promise((_resolve, reject) => {
    service.pending.set(1, { resolve: _resolve, reject, type: 'getSessions', startedAt: Date.now() })
  })
  const second = new Promise((_resolve, reject) => {
    service.pending.set(2, { resolve: _resolve, reject, type: 'getMessages', startedAt: Date.now() })
  })

  assert.doesNotThrow(() => service.handleWorkerExit(0))
  await assert.rejects(first, /意外退出.*退出码 0.*2 个请求已安全结束/)
  await assert.rejects(second, /意外退出.*退出码 0.*2 个请求已安全结束/)
  assert.equal(service.pending.size, 0)
  assert.equal(service.worker, null)
  assert.deepEqual(service.getQueueHealth().workerLifecycle, {
    unexpectedExitCount: 1,
    lastExitAt: service.getQueueHealth().workerLifecycle.lastExitAt,
    lastExitCode: 0,
    lastExitRejectedRequests: 2,
    awaitingRestart: true,
    workerActive: false
  })
  assert.match(service.getQueueHealth().workerLifecycle.lastExitAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('an expected shutdown exit leaves shutdown-owned pending cleanup untouched', () => {
  const service = new WcdbService() as any
  let rejected = false
  service.worker = { marker: 'closing-worker' }
  service.shuttingDown = true
  service.pending.set(1, {
    resolve: () => {}, reject: () => { rejected = true }, type: 'close', startedAt: Date.now()
  })
  service.handleWorkerExit(0)
  assert.equal(rejected, false)
  assert.equal(service.pending.size, 1)
  assert.equal(service.getQueueHealth().workerLifecycle.unexpectedExitCount, 0)
  assert.equal(service.getQueueHealth().workerLifecycle.awaitingRestart, false)
})

test('a lazily recreated worker clears the current incident without erasing history', () => {
  const service = new WcdbService() as any
  service.unexpectedWorkerExitCount = 2
  service.workerLastExitAt = new Date().toISOString()
  service.workerLastExitCode = 0
  service.workerLastExitRejectedRequests = 3
  service.worker = { marker: 'replacement-worker' }
  const health = service.getQueueHealth().workerLifecycle
  assert.equal(health.awaitingRestart, false)
  assert.equal(health.workerActive, true)
  assert.equal(health.unexpectedExitCount, 2)
  assert.equal(health.lastExitRejectedRequests, 3)
})

test('historical queue rejection does not remain a current backpressure incident', () => {
  const service = new WcdbService() as any
  service.queueRejectedCount = 4
  service.queueLastRejectedAt = new Date().toISOString()
  service.queueLastRejectedType = 'getMessages'
  const health = service.getQueueHealth()
  assert.equal(health.rejectedCount, 4)
  assert.equal(health.currentlyBackpressured, false)
})

test('WCDB monitor delivery contains callback errors, redacts them, and recovers', () => {
  const service = new WcdbService() as any
  service.monitorListener = () => {
    throw new Error('failed at /Users/private-name/Documents/chat.sqlite')
  }
  assert.doesNotThrow(() => service.deliverMonitorEvent({
    type: 'update',
    json: '{"private":"message body"}'
  }))
  const failed = service.getQueueHealth().monitorDelivery
  assert.equal(failed.failures, 1)
  assert.doesNotMatch(failed.lastError, /private-name|chat\.sqlite|message body/)

  service.monitorListener = () => {}
  service.deliverMonitorEvent({ type: 'update', json: '{}' })
  const recovered = service.getQueueHealth().monitorDelivery
  assert.equal(recovered.failures, 0)
  assert.equal(recovered.lastError, '')
  assert.match(recovered.lastSuccessAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('idle WCDB shutdown uses an acknowledged process-exit detach without native close', async () => {
  const service = new WcdbService() as any
  const sent: Array<{ id: number; type: string }> = []
  let terminateCalls = 0
  let unrefCalls = 0
  service.worker = {
    postMessage: (message: { id: number; type: string }) => {
      sent.push(message)
      queueMicrotask(() => {
        const pending = service.pending.get(message.id)
        service.pending.delete(message.id)
        pending?.resolve({ success: true, strategy: 'process_exit_detach' })
      })
    },
    terminate: async () => { terminateCalls += 1; return 0 },
    unref: () => { unrefCalls += 1 }
  }

  const result = await service.shutdown()
  assert.deepEqual(sent.map(item => item.type), ['prepareForProcessExit'])
  assert.equal(terminateCalls, 0)
  assert.equal(unrefCalls, 1)
  assert.deepEqual(result, {
    gracefulClose: true,
    workerTerminated: false,
    workerDetached: true,
    shutdownStrategy: 'process_exit_detach',
    boundedFallback: false,
    pendingBeforeClose: 0,
    pendingTypes: [],
    oldestPendingMs: 0
  })
})

test('WCDB process-exit preparation avoids the native shutdown call', () => {
  const workerSource = readFileSync(join(root, 'electron/wcdbWorker.ts'), 'utf8')
  const coreSource = readFileSync(join(root, 'electron/services/wcdbCore.ts'), 'utf8')
  const workerCase = workerSource.match(/case 'prepareForProcessExit':[\s\S]*?break/)?.[0] || ''
  const coreMethod = coreSource.match(/prepareForProcessExit\(\): void \{[\s\S]*?\n  \}/)?.[0] || ''
  assert.match(workerCase, /core\.prepareForProcessExit\(\)/)
  assert.doesNotMatch(workerCase, /core\.close\(\)/)
  assert.match(coreMethod, /this\.stopPeriodicPurge\(\)/)
  assert.match(coreMethod, /this\.stopLogPolling\(\)/)
  assert.doesNotMatch(coreMethod, /wcdbShutdown|cloudStop|stopMonitor\(\)/)
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
  assert.match(page, /当前背压/)
  assert.match(page, /安全关闭请求始终保留入口/)
  assert.match(page, /监控事件边界/)
  assert.match(page, /原始数据库事件内容未写入诊断/)
  assert.match(page, /Worker 生命周期/)
})
