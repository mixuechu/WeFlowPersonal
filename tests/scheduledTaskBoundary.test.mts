import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runScheduledTaskSafely } from '../electron/services/scheduledTaskBoundary.ts'
import {
  emptyLegacyBackgroundHealth,
  recordLegacyBackgroundFailure,
  recordLegacyBackgroundSuccess
} from '../electron/services/legacyBackgroundHealth.ts'

test('scheduled task boundary contains synchronous and asynchronous failures', async () => {
  const observed: string[] = []
  await assert.doesNotReject(runScheduledTaskSafely({
    task: () => { throw new Error('sync failure') },
    onError: error => observed.push((error as Error).message)
  }))
  await assert.doesNotReject(runScheduledTaskSafely({
    task: async () => { throw new Error('async failure') },
    onError: error => observed.push((error as Error).message)
  }))
  assert.deepEqual(observed, ['sync failure', 'async failure'])
})

test('scheduled task boundary always runs rescheduling and contains its failure', async () => {
  const order: string[] = []
  await assert.doesNotReject(runScheduledTaskSafely({
    task: async () => {
      order.push('task')
      throw new Error('task failed')
    },
    onError: error => order.push((error as Error).message),
    onFinally: () => {
      order.push('reschedule')
      throw new Error('reschedule failed')
    }
  }))
  assert.deepEqual(order, ['task', 'task failed', 'reschedule', 'reschedule failed'])
})

test('a broken diagnostic reporter cannot create a second timer rejection', async () => {
  await assert.doesNotReject(runScheduledTaskSafely({
    task: () => { throw new Error('work failed') },
    onError: () => { throw new Error('logger failed') }
  }))
})

test('legacy background health is bounded, redacted and clears only after success', () => {
  const failed = recordLegacyBackgroundFailure(
    emptyLegacyBackgroundHealth(),
    new Error('failed at /Users/private-name/Documents/chat.sqlite'),
    new Date('2026-08-13T08:00:00.000Z')
  )
  assert.equal(failed.consecutiveFailures, 1)
  assert.equal(failed.lastErrorAt, '2026-08-13T08:00:00.000Z')
  assert.doesNotMatch(failed.lastError, /private-name|chat\.sqlite/)

  const recovered = recordLegacyBackgroundSuccess(failed, new Date('2026-08-13T08:01:00.000Z'))
  assert.equal(recovered.consecutiveFailures, 0)
  assert.equal(recovered.lastError, '')
  assert.equal(recovered.lastSuccessAt, '2026-08-13T08:01:00.000Z')
})

test('successful scheduled work publishes health before rescheduling', async () => {
  const order: string[] = []
  await runScheduledTaskSafely({
    task: () => { order.push('task') },
    onSuccess: () => { order.push('healthy') },
    onError: () => { order.push('error') },
    onFinally: () => { order.push('reschedule') }
  })
  assert.deepEqual(order, ['task', 'healthy', 'reschedule'])
})

test('legacy AI timers route fire-and-forget promises through the final boundary', () => {
  for (const path of [
    '../electron/services/insightService.ts',
    '../electron/services/groupSummaryService.ts',
    '../electron/services/messagePushService.ts'
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /runScheduledTaskSafely\(/, `${path} should use the final timer boundary`)
  }
})

test('complete diagnostics expose privacy-minimal current-run service health', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(main, /legacyBackgroundServices:[\s\S]*insightService\.getRuntimeHealth\(\)[\s\S]*groupSummaryService\.getRuntimeHealth\(\)[\s\S]*messagePushService\.getRuntimeHealth\(\)/)
  assert.match(page, /辅助 AI 后台服务/)
  assert.match(page, /当前应用运行期的脱敏健康/)
})

test('legacy AI services propagate operational failure to the health boundary', () => {
  const insight = readFileSync(new URL('../electron/services/insightService.ts', import.meta.url), 'utf8')
  const summary = readFileSync(new URL('../electron/services/groupSummaryService.ts', import.meta.url), 'utf8')
  const push = readFileSync(new URL('../electron/services/messagePushService.ts', import.meta.url), 'utf8')
  assert.match(insight, /沉默扫描出错:[\s\S]*?throw e/)
  assert.match(insight, /活跃分析出错:[\s\S]*?throw e/)
  assert.match(summary, /群聊自动总结暂时无法连接微信数据库/)
  assert.match(summary, /自动总结失败:[\s\S]*?throw error/)
  assert.match(push, /消息推送暂时无法连接微信数据库/)
  assert.match(push, /消息推送暂时无法读取会话目录/)
  assert.match(push, /this\.rerunRequested = true[\s\S]*?throw new Error/)
  assert.match(push, /消息推送启动时无法连接微信数据库/)
  assert.match(push, /消息推送启动时无法读取会话目录/)
})
