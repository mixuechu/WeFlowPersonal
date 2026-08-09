import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appRunDurationLabel,
  appRunElapsedLabel,
  appRunExitReasonLabel,
  appRunIncidentLabel,
  appRunShutdownDetailLabel,
  appRunShutdownDetailNeedsAttention,
  appRunShutdownStatusLabel,
  appRunShutdownStepLabel,
  appRunStageLabel,
  buildRendererPageIncidentNotice
} from '../src/utils/appRecoveryPresentation.ts'

test('app recovery presentation translates persisted machine states into user-facing Chinese', () => {
  assert.equal(appRunStageLabel('services_ready'), '全部服务已就绪')
  assert.equal(appRunExitReasonLabel('unknown_interruption'), '进程意外中断或设备断电')
  assert.equal(appRunExitReasonLabel('shutdown_interrupted'), '安全退出途中中断')
  assert.equal(appRunExitReasonLabel(undefined, true), '正常结束')
  assert.equal(appRunIncidentLabel('renderer_gone'), '界面进程退出')
  assert.equal(appRunShutdownStepLabel('wcdb-worker-stop'), '微信数据库停止')
  assert.equal(appRunShutdownStatusLabel('running'), '执行中被中断')
})

test('app recovery presentation explains structured shutdown diagnostics without raw JSON', () => {
  assert.equal(appRunShutdownDetailLabel('wcdb-worker-stop', JSON.stringify({
    gracefulClose: true,
    workerDetached: true,
    shutdownStrategy: 'process_exit_detach',
    boundedFallback: false
  })), '只读 Worker 已确认静默，并随应用退出回收')
  assert.equal(appRunShutdownDetailLabel('wcdb-worker-stop', JSON.stringify({
    gracefulClose: false,
    workerTerminated: false,
    shutdownStrategy: 'forced_terminate',
    boundedFallback: true,
    pendingBeforeClose: 3
  })), '原生请求未及时结束，已进入有界退出兜底（退出前 3 项）')
  assert.equal(appRunShutdownDetailLabel('wcdb-worker-stop', JSON.stringify({
    gracefulClose: true,
    workerTerminated: true,
    shutdownStrategy: 'no_worker'
  })), '本次没有已启动的微信数据库 Worker')
  assert.equal(appRunShutdownDetailLabel('ai-assistant-stop', JSON.stringify({
    waited: 2,
    timedOut: false,
    pending: [],
    databaseClosed: true
  })), '后台任务已落定（等待 2 项），记忆数据库已安全关闭')
  assert.equal(appRunShutdownDetailLabel('ai-assistant-stop', JSON.stringify({
    waited: 4,
    timedOut: true,
    pending: ['incremental_sync'],
    databaseClosed: false
  })), '等待后台任务达到上限，仍有 1 项交由进程退出回收')
  assert.equal(appRunShutdownDetailLabel('unknown-step', '{"private":"machine-state"}'), '已记录结构化诊断详情')
  assert.equal(appRunShutdownDetailLabel('unknown-step', '普通错误'), '普通错误')
  assert.equal(appRunShutdownDetailNeedsAttention('wcdb-worker-stop', JSON.stringify({
    shutdownStrategy: 'process_exit_detach', boundedFallback: false
  })), false)
  assert.equal(appRunShutdownDetailNeedsAttention('wcdb-worker-stop', JSON.stringify({
    shutdownStrategy: 'forced_terminate', boundedFallback: true
  })), true)
  assert.equal(appRunShutdownDetailNeedsAttention('ai-assistant-stop', JSON.stringify({
    timedOut: true
  })), true)
  assert.equal(appRunShutdownDetailNeedsAttention('unknown-step', '{broken'), false)
})

test('app recovery presentation reports bounded durations without inventing invalid timing', () => {
  assert.equal(appRunDurationLabel(4), '4 毫秒')
  assert.equal(appRunDurationLabel(1_250), '1.3 秒')
  assert.equal(appRunDurationLabel(65_000), '1 分 5 秒')
  assert.equal(appRunDurationLabel(-1), '耗时未知')
  assert.equal(
    appRunElapsedLabel('2026-08-09T00:00:00.000Z', '2026-08-09T00:02:05.000Z'),
    '持续 2 分 5 秒'
  )
  assert.equal(appRunElapsedLabel('invalid', '2026-08-09T00:02:05.000Z'), '持续时间未知')
})

test('app recovery presentation exposes only current renderer page incidents in latest-first order', () => {
  assert.deepEqual(buildRendererPageIncidentNotice({
    current: {
      incidents: [
        { kind: 'renderer_page_error', at: '2026-08-10T01:00:00.000Z', detail: 'resources · ChunkLoadError · 摘要 aaa' },
        { kind: 'renderer_gone', at: '2026-08-10T01:10:00.000Z', detail: '界面进程退出' },
        { kind: 'renderer_page_error', at: '2026-08-10T01:20:00.000Z', detail: 'ai_assistant · TypeError · 摘要 bbb' },
        { kind: 'renderer_page_error', at: 'invalid', detail: '不应展示' }
      ]
    },
    history: [{ incidents: [{ kind: 'renderer_page_error', at: '2026-08-09T01:00:00.000Z' }] }]
  }), {
    count: 2,
    latestAt: '2026-08-10T01:20:00.000Z',
    latestDetail: 'ai_assistant · TypeError · 摘要 bbb'
  })
  assert.equal(buildRendererPageIncidentNotice({ current: { incidents: [] } }), null)
  assert.equal(buildRendererPageIncidentNotice(null), null)
})

test('app recovery page incident notice bounds persisted presentation detail', () => {
  const notice = buildRendererPageIncidentNotice({
    current: { incidents: [{
      kind: 'renderer_page_error',
      at: '2026-08-10T01:00:00.000Z',
      detail: 'x'.repeat(500)
    }] }
  })
  assert.equal(notice?.latestDetail.length, 300)
})
