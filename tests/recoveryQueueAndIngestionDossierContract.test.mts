import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

for (const [key, message] of [
  ['ingestion_dossier', '增量运行批次详情连续三次读取均发生变化'],
  ['ingestion_recovery_queue', '增量恢复队列连续三次读取均发生变化'],
  ['cross_store_recovery_queue', '写入恢复队列连续三次读取均发生变化']
] as const) {
  test(`${key} has bounded stale recovery and a manual fallback`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${key}'`))
    assert.match(page, new RegExp(message))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${key}'\\)`))
  })
}

test('ingestion batch continuation retains loaded batches on failure', () => {
  const start = page.indexOf('const loadMoreIngestionBatches = async () => {')
  const end = page.indexOf('const loadIngestionRecoveryQueue = async', start)
  const loader = page.slice(start, end)

  assert.match(loader, /if \(page\.stale\) \{[\s\S]*\.\.\.current,[\s\S]*batchError:/)
  assert.doesNotMatch(loader, /void loadIngestionDossier/)
  assert.match(loader, /catch \(error: any\) \{[\s\S]*\.\.\.current,[\s\S]*batchError:/)
  assert.match(page, /ingestionDossier\.batchError[\s\S]*重新载入最新详情/)
})

test('recovery queue errors cannot masquerade as empty queues', () => {
  assert.match(page, /!ingestionRecoveryQueue\.loading && !ingestionRecoveryQueue\.error &&[\s\S]*恢复队列已经清空/)
  assert.match(page, /ingestionRecoveryQueue\.error[\s\S]*loadIngestionRecoveryQueue\(\)/)
  assert.match(page, /!crossStoreRecoveryQueue\.loading && !crossStoreRecoveryQueue\.error &&[\s\S]*写入恢复队列已经清空/)
  assert.match(page, /crossStoreRecoveryQueue\.error[\s\S]*loadCrossStoreRecoveryQueue\(\)/)
})
