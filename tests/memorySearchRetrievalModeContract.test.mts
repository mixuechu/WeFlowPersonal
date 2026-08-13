import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')
const electronTypes = readFileSync(join(root, 'src/types/electron.d.ts'), 'utf8')

test('memory search discloses its actual retrieval mode and binds it across pages', () => {
  assert.match(service, /execution\.mode = 'lexical_ai_disabled'/)
  assert.match(service, /execution\.mode = 'lexical_vector_fallback'/)
  assert.match(service, /execution\.mode = 'hybrid'/)
  assert.match(service, /expectedRetrievalMode[\s\S]*expectedRetrievalMode !== page\.retrievalMode[\s\S]*retrievalModeStale: true/)
  assert.match(page, /retrievalMode: memorySearchState\.retrievalMode/)
  assert.match(page, /AI 助理已关闭，本次仅使用本机全文检索，未加载向量模型/)
  assert.match(page, /语义检索暂不可用，本次已明确回退本机全文检索/)
  assert.match(page, /本机全文＋语义混合检索/)
  assert.match(electronTypes, /retrievalMode\?: 'hybrid' \| 'lexical_ai_disabled' \| 'lexical_vector_fallback' \| 'lexical_archive' \| 'scope_browse'/)
  assert.match(electronTypes, /retrievalModeStale\?: boolean/)
})

test('RAG query plans retain every actual retrieval mode', () => {
  assert.match(service, /const retrievalModes = new Set<string>\(\)/)
  assert.match(service, /if \(execution\.mode\) retrievalModes\.add\(execution\.mode\)/)
  assert.match(service, /\(plan as any\)\.retrievalModes = \[\.\.\.retrievalModes\]\.sort\(\)/)
})
