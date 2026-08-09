import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectRuntimeMemoryDiagnostics } from '../electron/services/runtimeMemoryDiagnostics.ts'

const root = process.cwd()

test('runtime memory diagnostics aggregate bounded process categories in bytes', () => {
  const result = collectRuntimeMemoryDiagnostics([
    { type: 'Browser', memory: { workingSetSize: 100, peakWorkingSetSize: 120 } },
    { type: 'Tab', memory: { workingSetSize: 40 } },
    { type: 'Tab', memory: { workingSetSize: 60 } },
    { type: 'Utility', memory: { workingSetSize: 80 } },
    { type: 'GPU', memory: { workingSetSize: 20 } },
    { type: 'unexpected-private-name', memory: { workingSetSize: 10 } }
  ], {
    rss: 90_000,
    heapUsed: 30_000,
    heapTotal: 50_000,
    external: 4_000,
    arrayBuffers: 2_000
  }, 400 * 1024, '2026-08-10T00:00:00.000Z')

  assert.equal(result.available, true)
  assert.equal(result.processes, 6)
  assert.equal(result.workingSetBytes, 310 * 1024)
  assert.equal(result.peakObservedBytes, 400 * 1024)
  assert.deepEqual(result.byType.renderer, { processes: 2, workingSetBytes: 100 * 1024 })
  assert.deepEqual(result.byType.utility, { processes: 1, workingSetBytes: 80 * 1024 })
  assert.deepEqual(result.byType.other, { processes: 1, workingSetBytes: 10 * 1024 })
  assert.equal(result.mainNode.heapUsedBytes, 30_000)
  assert.equal(result.units, 'bytes')
  assert.equal(result.supplementalProcesses, 0)
})

test('runtime memory diagnostics include registered workers once without exposing identity', () => {
  const result = collectRuntimeMemoryDiagnostics([
    { pid: 10, type: 'Browser', memory: { workingSetSize: 100 } },
    { pid: 20, type: 'Utility', memory: { workingSetSize: 50 } }
  ], { rss: 100 * 1024 }, 0, '2026-08-10T00:00:00.000Z', [
    { pid: 20, type: 'utility', workingSetBytes: 999 * 1024 },
    { pid: 30, type: 'utility', workingSetBytes: 200 * 1024 }
  ])

  assert.equal(result.processes, 3)
  assert.equal(result.workingSetBytes, 350 * 1024)
  assert.equal(result.byType.utility.workingSetBytes, 250 * 1024)
  assert.equal(result.supplementalProcesses, 1)
  assert.equal('pid' in result, false)
})

test('runtime memory diagnostics fall back to main RSS when Electron metrics are unavailable', () => {
  const result = collectRuntimeMemoryDiagnostics([], {
    rss: 123_456,
    heapUsed: Number.NaN,
    heapTotal: -1
  }, 100_000, '2026-08-10T00:00:00.000Z')

  assert.equal(result.available, false)
  assert.equal(result.processes, 1)
  assert.equal(result.workingSetBytes, 123_456)
  assert.equal(result.peakObservedBytes, 123_456)
  assert.equal(result.mainNode.heapUsedBytes, 0)
  assert.equal(result.mainNode.heapTotalBytes, 0)
})

test('full diagnostics expose the aggregate without process identities', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const embeddingService = readFileSync(join(root, 'electron/services/localEmbeddingService.ts'), 'utf8')
  const embeddingWorker = readFileSync(join(root, 'electron/localEmbeddingWorker.ts'), 'utf8')
  const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')
  assert.match(service, /app\.getAppMetrics\(\)/)
  assert.match(service, /localEmbeddingService\.getRuntimeProcessMemory\(\)/)
  assert.match(service, /runtimeMemory,/)
  assert.match(page, /桌面运行内存/)
  assert.match(page, /runtimeMemory\.byType\?\.utility/)
  assert.doesNotMatch(page, /runtimeMemory\.(?:pid|name|serviceName)/)
  assert.match(embeddingService, /getRuntimeProcessMemory\(\)/)
  assert.match(embeddingWorker, /runtimeMemory:/)
  assert.doesNotMatch(embeddingWorker, /runtimeMemory:[\s\S]{0,300}(?:argv|env|cwd)/)
})
