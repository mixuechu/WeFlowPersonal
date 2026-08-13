import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('ingestion archive distinguishes loading, authoritative empty and failed states', () => {
  assert.match(page, /增量运行档案读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有增量运行记录”/)
  assert.match(page, /!ingestionArchive\.error && !ingestionArchive\.items\.length/)
  assert.match(page, /运行档案读取失败；当前不能据此判断历史运行数量/)
})

test('ingestion continuation failures preserve runs and retry the exact archive page', () => {
  assert.match(page, /setIngestionArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*次运行及批次详情仍可审阅，但当前档案尚未读完/)
  assert.match(page, /if \(ingestionArchive\.items\.length\) void loadMoreIngestionRuns\(\)/)
  assert.match(page, /offset: ingestionArchive\.items\.length,[\s\S]*revision: ingestionArchive\.revision/)
  assert.match(page, /ingestionArchive\.hasMore && !ingestionArchive\.error/)
})

test('ingestion diagnostics separate recent reliability from lifetime audit totals', () => {
  assert.match(page, /近期增量可靠性/)
  assert.match(page, /recent24Hours\.completed/)
  assert.match(page, /recent7Days\?\.completed/)
  assert.match(page, /completedWithBatchesSinceLatestDegraded/)
  assert.match(page, /completedWithoutBatchesSinceLatestDegraded/)
  assert.match(page, /次实际抽取完成/)
  assert.match(page, /次无新增正常结束/)
  assert.match(page, /latestSuccessfulExtractionAt/)
  assert.match(page, /operationalFailedBatchesSinceLatestSuccessfulExtraction/)
  assert.match(page, /controlledInterruptedBatchesSinceLatestSuccessfulExtraction/)
  assert.match(page, /latestOperationalFailureAt/)
  assert.match(page, /latestControlledInterruptionAt/)
  assert.match(page, /近期窗口按运行与批次的最终活动时间计算/)
  assert.match(page, /失败批次作为尝试审计永久保留/)
  assert.match(page, /该成功边界之后/)
  assert.match(page, /受控中断/)
  assert.match(page, /历史失败分类/)
  assert.match(page, /unclassifiedFailedBatches/)
  assert.match(page, /ingestionArchiveBatchOutcome/)
  assert.match(page, /ingestionArchiveWindow/)
  assert.match(page, /openIngestionBatchAudit\('operational_failure'\)/)
  assert.match(page, /openIngestionBatchAudit\('controlled_interruption'\)/)
  assert.match(page, /审阅 24 小时真实异常/)
  assert.match(page, /审阅 24 小时受控中断/)
  assert.match(page, /最终活动从/)
  assert.match(page, /最终活动到/)
  assert.match(page, /run\.activity_at \|\| run\.started_at/)
  assert.match(page, /历史失败批次/)
})
