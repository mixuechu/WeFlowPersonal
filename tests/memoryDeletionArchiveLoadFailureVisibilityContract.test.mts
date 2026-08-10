import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('memory deletion audit distinguishes failed loading from no deletion history', () => {
  assert.match(page, /删除与不重要审计读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有删除或不重要清理记录”/)
  assert.match(page, /!memoryDeletionArchive\.error && !memoryDeletionArchive\.items\.length/)
  assert.match(page, /读取失败；当前不能据此判断删除或不重要清理数量/)
})

test('memory deletion continuation preserves irreversible audit and exact retry scope', () => {
  assert.match(page, /setMemoryDeletionArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*条不可逆审计仍可核验，但当前档案尚未读完/)
  assert.match(page, /if \(memoryDeletionArchive\.items\.length\) void loadMoreMemoryDeletionAudit\(\)/)
  assert.match(page, /offset: memoryDeletionArchive\.items\.length,[\s\S]*revision: memoryDeletionArchive\.revision/)
  assert.match(page, /memoryDeletionArchive\.hasMore && !memoryDeletionArchive\.error/)
})
