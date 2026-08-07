import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)
const preload = readFileSync(
  new URL('../electron/preload.ts', import.meta.url),
  'utf8'
)
const main = readFileSync(
  new URL('../electron/main.ts', import.meta.url),
  'utf8'
)
const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('memory growth is a first-class pageable archive with current dossier navigation', () => {
  const growth = page.indexOf('id="memory-growth"')
  const ingestion = page.indexOf('{ingestionStatus && (')
  assert.ok(growth >= 0)
  assert.ok(ingestion > growth)
  assert.match(page.slice(growth, ingestion), /memoryGrowthKind/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthChange/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthDetail/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthOrigin/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthSource/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthConnectorOperation/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthOriginSummary/)
  assert.match(page.slice(growth, ingestion), /openMemoryGrowthOriginDossier/)
  assert.match(page, /memory-growth-origin-dossier-title/)
  assert.match(page.slice(growth, ingestion), /value="enriched"/)
  assert.match(page.slice(growth, ingestion), /entry\.changeDetail/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthEntity/)
  assert.match(page.slice(growth, ingestion), /loadMoreMemoryGrowth/)
  assert.match(page.slice(growth, ingestion), /openMemoryGrowthItem/)
  assert.match(page, /id="entity-dossier-memory-growth"/)
  assert.match(page, /loadMoreEntityMemoryGrowth/)
  assert.match(page, /memoryDiagnostics\.memoryChangeLogHealthy/)
  assert.match(page, /memoryDiagnostics\.memoryChangeLog\.connectorOperationIndex/)
  assert.match(page, /记忆成长账本与连接器操作索引/)
  assert.match(page, /memoryDiagnostics\.reviewInboxIndexesHealthy/)
  assert.match(page, /统一审阅收件箱查询索引/)
  assert.match(page, /memorySearchRepairResult\.repaired\.reviewInboxIndexes/)
  assert.match(page, /memorySearchRepairResult\.repaired\.memoryChangeConnectorOperationIndex/)
  assert.match(page, /getCurrentStructuredMemoryDossier\(structuredKind, id\)/)
  assert.match(page, /openSearchResourceDossier\(id\)/)
  assert.match(preload, /getMemoryChangeLogPage/)
  assert.match(preload, /getMemoryChangeOriginDossier/)
  assert.match(main, /ai-assistant:getMemoryChangeLogPage/)
  assert.match(main, /ai-assistant:getMemoryChangeOriginDossier/)
  assert.match(service, /entityId: String\(options\?\.entityId \|\| ''\)/)
  const backupMethod = service.slice(
    service.indexOf('  createMemoryBackup('),
    service.indexOf('  private inspectMemoryBackupForRestore')
  )
  assert.match(backupMethod, /getBackgroundWriteConflict/)
  assert.match(backupMethod, /allowDuringActiveSync/)
  assert.match(backupMethod, /deferRetention: true/)
  assert.match(backupMethod, /createJointMemoryBackup/)
  assert.match(backupMethod, /requireStateSidecar: true/)
  assert.match(backupMethod, /isRestorable: backup => this\.inspectJointMemoryBackup\(backup\.path\)\.restorable/)
  assert.match(service, /auditJointMemoryBackupInventory/)
  assert.match(service, /jointBackupValidationCache/)
  assert.match(service, /stat\.dev.*stat\.ino.*stat\.size.*stat\.mtimeMs.*stat\.ctimeMs/)
  assert.match(service, /createMemoryBackup\(\[\], \{ allowDuringActiveSync: true \}\)/)
  assert.match(page, /完成后才能创建数据库与状态一致的联合快照/)
  assert.match(page, /memoryDiagnostics\.backupPairIntegrity\.databaseOnly/)
  assert.match(page, /数据库与 AI 状态联合快照配对状态/)
  assert.match(page, /只有实际可恢复的组合才占最近十份名额/)
  assert.match(page, /memoryDiagnostics\.backupRestoreAudit\?\.restorable/)
  assert.match(page, /配对但验证失败/)
})
