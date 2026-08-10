import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('cross-store recovery archive distinguishes failure from no interrupted writes', () => {
  assert.match(page, /跨存储写入处理档案读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有跨存储写入记录”/)
  assert.match(page, /!crossStoreRecoveryArchive\.error && !crossStoreRecoveryArchive\.items\?\.length/)
  assert.match(page, /读取失败；当前不能据此判断跨存储写入历史数量/)
  assert.match(page, /!crossStoreRecoveryArchive\.error && <div className="assistant-recovery-current">/)
})

test('cross-store recovery continuation keeps loaded decisions and exact retry scope', () => {
  assert.match(page, /setCrossStoreRecoveryArchive\(\(current: any\) => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*条处理记录仍可审阅，但当前档案尚未读完/)
  assert.match(page, /if \(crossStoreRecoveryArchive\.items\?\.length\) void loadMoreCrossStoreRecoveryArchive\(\)/)
  assert.match(page, /offset: crossStoreRecoveryArchive\.items\?\.length \|\| 0,[\s\S]*revision: crossStoreRecoveryArchive\.revision/)
  assert.match(page, /crossStoreRecoveryArchive\.hasMore && !crossStoreRecoveryArchive\.error/)
})
