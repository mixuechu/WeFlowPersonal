import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('assistant conversation archive distinguishes loading, empty and failed states', () => {
  assert.match(page, /问答会话档案读取失败/)
  assert.match(page, /当前不会把失败解释为“还没有本地问答记录”/)
  assert.match(page, /!assistantArchive\.loading && !assistantArchive\.error && !assistantConversations\.length/)
  assert.match(page, /assistantArchive\.error && !assistantConversations\.length[\s\S]*'读取失败'/)
})

test('assistant archive continuation failures keep usable conversations and exact retry scope', () => {
  assert.match(page, /setAssistantArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*段会话仍可打开，但当前档案尚未读完/)
  assert.match(page, /if \(assistantConversations\.length\) void loadMoreAssistantConversations\(\)/)
  assert.match(page, /offset: assistantArchive\.items\.length,[\s\S]*revision: assistantArchive\.revision/)
  assert.match(page, /assistantArchive\.hasMore && !assistantArchive\.error/)
})
