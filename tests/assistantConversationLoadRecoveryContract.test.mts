import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const start = page.indexOf('  const openMemoryConversation = useCallback')
const end = page.indexOf('\n  const loadMoreAssistantConversations', start)
const loader = page.slice(start, end)

test('opening an archived conversation has a bounded consistent-snapshot retry', () => {
  assert.ok(start >= 0 && end > start)
  assert.match(loader, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(loader, /250 \* \(attempt \+ 1\)/)
  assert.match(loader, /三次重新读取仍未获得一致快照/)
  assert.doesNotMatch(loader, /void openMemoryConversation\(/)
})

test('conversation read failures are caught, visible and exactly retryable', () => {
  assert.match(loader, /try \{[\s\S]*catch \(error: any\)/)
  assert.match(loader, /setMemoryConversationLoad\(\{[\s\S]*status: 'error',[\s\S]*targetId: id,[\s\S]*anchorMessageId/)
  assert.match(page, /memoryConversationLoad\.status === 'error'[\s\S]*所选会话读取失败/)
  assert.match(page, /openMemoryConversation\([\s\S]*memoryConversationLoad\.targetId,[\s\S]*memoryConversationLoad\.anchorMessageId/)
  assert.match(page, /当前已打开的会话仍保留，失败不会被解释为空记录/)
  assert.match(page, /!memoryConversation && memoryConversationLoad\.status === 'idle'/)
})

test('older-message continuation failures preserve the prefix and remain retryable', () => {
  const continuationStart = page.indexOf('  const loadOlderAssistantMessages = async () =>')
  const continuationEnd = page.indexOf('\n  useEffect(() => {', continuationStart)
  const continuation = page.slice(continuationStart, continuationEnd)
  assert.match(continuation, /setAssistantMessagesLoadError\(''\)/)
  assert.match(continuation, /setAssistantMessagesLoadError\(errorMessage\)/)
  assert.match(continuation, /offset: Number\(memoryConversation\.offset \|\| 0\) \+ Number\(memoryConversation\.messages\?\.length \|\| 0\)/)
  assert.match(continuation, /if \(older\.stale\)[\s\S]*setAssistantMessagesLoadingMore\(false\)[\s\S]*openMemoryConversation\(memoryConversationId, memoryConversation\.anchorMessageId \|\| ''\)/)
  assert.match(continuation, /\.\.\.older,[\s\S]*offset: current\.offset,[\s\S]*messages:/)
  assert.match(page, /assistantMessagesLoadError &&[\s\S]*更早消息读取失败/)
  assert.match(page, /已显示的消息保持不变，当前会话尚未读完/)
  assert.match(page, /重试加载更早消息/)
})

test('answer hydration cannot overwrite a newer conversation selection', () => {
  const start = page.indexOf('const askMemory = async () => {')
  const end = page.indexOf('const selectMemoryEntityScope = async', start)
  const ask = page.slice(start, end)

  const hydration = ask.indexOf('.getAssistantConversation(answer.conversationId)')
  const postHydrationGate = ask.indexOf(
    'if (!memoryConversationGate.current.isCurrent(request)) return',
    hydration
  )
  const publish = ask.indexOf('else if (conversation) setMemoryConversation(conversation)', hydration)
  assert.ok(hydration >= 0)
  assert.ok(postHydrationGate > hydration)
  assert.ok(publish > postHydrationGate)
  assert.match(ask, /回答已生成并保存，但会话原文暂未加载/)
  assert.doesNotMatch(ask, /else setMemoryConversation\(conversation\)/)
})

test('resource trash first-page failures are visible and retryable', () => {
  assert.match(page, /resourceTrashArchive\.status === 'error'[\s\S]*资源回收站读取失败：[\s\S]*setResourceRefreshKey\(value => value \+ 1\)/)
})
