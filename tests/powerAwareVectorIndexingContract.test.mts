import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
const main = readFileSync(join(root, 'electron/main.ts'), 'utf8')
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('power state changes gate only automatic vector continuation and resume it on AC', () => {
  assert.match(main, /powerMonitor\.isOnBatteryPower\(\)/)
  assert.match(main, /powerMonitor\.getCurrentThermalState\(\)/)
  assert.match(main, /process\.getSystemMemoryInfo\(\)/)
  assert.match(main, /memory\.free[\s\S]*memory\.purgeable[\s\S]*memory\.fileBacked/)
  assert.match(main, /setInterval\(updateAiAssistantPowerState, 30_000\)/)
  assert.match(main, /powerMonitor\.on\('on-ac', updateAiAssistantPowerState\)/)
  assert.match(main, /powerMonitor\.on\('on-battery', updateAiAssistantPowerState\)/)
  assert.match(main, /powerMonitor\.on\('thermal-state-change', updateAiAssistantPowerState\)/)
  assert.match(service, /updatePowerState\([\s\S]*?if \(next\.deferred\)[\s\S]*?clearTimeout\(this\.vectorIndexContinuation\)/)
  assert.match(service, /if \(wasDeferred && this\.statePath && this\.config\.get\('aiAssistantEnabled'\)\)[\s\S]*?this\.scheduleVectorIndexContinuation\(\)/)
  assert.match(service, /scheduleVectorIndexContinuation\([\s\S]*?this\.vectorIndexPowerPolicy\.deferred/)
  assert.doesNotMatch(
    service.match(/async ensureVectorIndex\([\s\S]*?\n  findGraphPath\(/)?.[0] || '',
    /vectorIndexPowerPolicy\.deferred/
  )
})

test('power deferral is visible beside semantic backlog progress', () => {
  assert.match(page, /使用电池 · 已暂停/)
  assert.match(page, /温度较高 · 已暂停/)
  assert.match(page, /等待插电或温度恢复/)
  assert.match(page, /恢复供电后继续计算/)
  assert.match(page, /可用内存不足 · 已暂停/)
  assert.match(page, /可用内存恢复后继续计算/)
  assert.match(page, /系统可用内存/)
})
