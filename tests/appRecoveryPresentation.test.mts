import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appRunDurationLabel,
  appRunElapsedLabel,
  appRunExitReasonLabel,
  appRunIncidentLabel,
  appRunShutdownStatusLabel,
  appRunShutdownStepLabel,
  appRunStageLabel
} from '../src/utils/appRecoveryPresentation.ts'

test('app recovery presentation translates persisted machine states into user-facing Chinese', () => {
  assert.equal(appRunStageLabel('services_ready'), '全部服务已就绪')
  assert.equal(appRunExitReasonLabel('unknown_interruption'), '进程意外中断或设备断电')
  assert.equal(appRunExitReasonLabel(undefined, true), '正常结束')
  assert.equal(appRunIncidentLabel('renderer_gone'), '界面进程退出')
  assert.equal(appRunShutdownStepLabel('wcdb-worker-stop'), '微信数据库停止')
  assert.equal(appRunShutdownStatusLabel('running'), '执行中被中断')
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
