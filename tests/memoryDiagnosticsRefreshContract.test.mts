import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')

test('memory diagnostics use one coalesced refresh path with bounded periodic retry', () => {
  assert.match(page, /memoryDiagnosticsRefresh = useRef\(new TrailingCoalescedRequest<any>\(\)\)/)
  assert.match(page, /const refreshMemoryDiagnostics = useCallback/)
  assert.match(page, /memoryDiagnosticsForceRequested\.current = true/)
  assert.match(page, /window\.setInterval\([\s\S]*refreshMemoryDiagnostics\(\)[\s\S]*60_000/)
  assert.doesNotMatch(
    page,
    /getMemoryDiagnostics\(\)\.then\(setMemoryDiagnostics\)\.catch\(\(\) => \{\}\)/
  )
  assert.equal((page.match(/window\.electronAPI\.aiAssistant\.getMemoryDiagnostics\(/g) || []).length, 1)
  assert.equal((page.match(/await refreshMemoryDiagnostics\(\)\.catch\(\(\) => \{\}\)/g) || []).length, 11)
})

test('diagnostic refresh failure remains visible and manually retryable without discarding last success', () => {
  assert.match(page, /个人记忆诊断暂时无法刷新/)
  assert.match(page, /界面仍保留.*最近成功结果/)
  assert.match(page, /当前尚无可验证的诊断结果/)
  assert.match(page, /memoryDiagnosticsLoadedAt[\s\S]*诊断刷新/)
  assert.match(page, /role="alert"/)
  assert.match(page, /onClick=\{\(\) => void refreshMemoryDiagnostics\(\)\.catch\(\(\) => \{\}\)\}/)
  assert.match(page, /onClick=\{\(\) => void refreshMemoryDiagnostics\(true\)\.catch\(\(\) => \{\}\)\}/)
})

test('a forced diagnostic verifies the pinned semantic model cache and explains deferral', () => {
  assert.match(service, /await localEmbeddingService\.verifyCacheIntegrity\(\)/)
  assert.match(page, /固定版本模型缓存缺少/)
  assert.match(page, /本次完整校验遇到正在使用的本地模型/)
})
