import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('scanned PDF continuation stops when the authoritative resource text budget is full', () => {
  assert.match(service, /projectedChars > RESOURCE_CONTENT_CHAR_LIMIT/)
  assert.match(service, /attachmentPdfOcrTruncated: storageTruncated \? false/)
  assert.match(service, /attachmentPdfOcrStorageTruncated: storageTruncated/)
  assert.match(service, /attachmentPdfOcrUnindexedFromPage: storageTruncated \? startPage : 0/)
})

test('resource dossiers disclose storage truncation and its model boundary', () => {
  assert.match(page, /contentStorageTruncated/)
  assert.match(page, /正文预算已满/)
  assert.match(page, /超出部分未被模型读取/)
  assert.match(page, /contentStorageCompletenessUnknown/)
  assert.match(page, /历史边界未知/)
  assert.match(page, /resourceContentBudget\.pendingLegacy/)
  assert.match(page, /空闲时自动接力核验/)
  assert.match(page, /migration\?\.lastError/)
})

test('legacy resource budget migration continues while idle and persists bounded failures', () => {
  assert.match(service, /getResourceContentBudgetStats\(\)[\s\S]*pendingLegacy/)
  assert.match(service, /this\.vectorIndexPromise \|\| this\.memorySearchRepairPromise/)
  assert.match(service, /repairLegacyResourceContentBudgets\(100\)/)
  assert.match(service, /recordResourceContentBudgetMigrationFailure\([\s\S]*sanitizeDiagnosticText/)
  assert.match(service, /resource_content_budget_progressed/)
  assert.match(service, /resource_content_budget_completed/)
  assert.match(store, /failureStreak: Math\.max\(0, Number\(previous\?\.failureStreak \|\| 0\)\) \+ 1/)
  assert.match(store, /return this\.db\.transaction\(\(\) => \{[\s\S]*for \(const row of rows\)[\s\S]*resource_content_budget_migration/)
})

test('disabling AI stops assistant work without blocking local resource repair', () => {
  assert.match(service, /if \(!this\.config\.get\('aiAssistantEnabled'\)\) \{[\s\S]*continueLegacyResourceContentBudgetMigration\(\)[\s\S]*assistant_disabled/)
  assert.match(service, /continueLegacyResourceContentBudgetMigration\(\): string \| null[\s\S]*this\.activeSync \|\| this\.vectorIndexPromise \|\| this\.memorySearchRepairPromise/)
  assert.match(service, /if \(!this\.config\.get\('aiAssistantEnabled'\)\)[\s\S]*if \(!this\.activeSync\) await this\.flushNotificationOutbox/)
  assert.match(service, /if \(this\.config\.get\('aiAssistantEnabled'\)\) this\.scheduleVectorIndexContinuation\(12_000\)/)
  assert.match(service, /scheduleVectorIndexContinuation\(delayMs = 1_000\)[\s\S]*!this\.config\.get\('aiAssistantEnabled'\)/)
  assert.match(service, /this\.vectorIndexContinuation = setTimeout[\s\S]*if \(!this\.config\.get\('aiAssistantEnabled'\)\)[\s\S]*type: 'cancelled'/)
  assert.match(service, /async sync[\s\S]*AI 助理已关闭，未开始增量处理或模型请求/)
  assert.match(service, /commitBatch: items => \{[\s\S]*AI 助理已关闭，本批向量未写入[\s\S]*saveEmbeddingBatch/)
  assert.match(service, /\.catch\(error => \{[\s\S]*!this\.config\.get\('aiAssistantEnabled'\)[\s\S]*type: 'cancelled'[\s\S]*return[\s\S]*本地向量索引暂未完成/)
  assert.match(service, /wasEnabled && !enabled[\s\S]*clearTimeout\(this\.vectorIndexContinuation\)[\s\S]*!wasEnabled && enabled[\s\S]*scheduleVectorIndexContinuation/)
  assert.match(service, /wasEnabled && !enabled[\s\S]*modelRequests\.cancelActive\('AI 助理已关闭，当前模型请求已取消'\)/)
  assert.match(service, /async askMemory[\s\S]*AI 助理已关闭，未开始记忆问答或模型请求/)
  assert.match(service, /async boundary => \{[\s\S]*AI 助理已关闭，本次问答未发送或保存/)
  assert.match(service, /const uncertainty = grounded\.uncertainty[\s\S]*AI 助理已关闭，本次回答未保存[\s\S]*saveAssistantExchangeDetailed/)
  assert.match(service, /const lexical = this\.searchMemory[\s\S]*!this\.config\.get\('aiAssistantEnabled'\)[\s\S]*semantic_search_disabled: true[\s\S]*localEmbeddingService\.embed/)
  assert.match(service, /private async callAi[\s\S]*AI 助理已关闭，未发送 DeepSeek 请求/)
  assert.match(service, /message\.includes\('AI 助理已关闭'\)[\s\S]*assistant_disabled/)
})
