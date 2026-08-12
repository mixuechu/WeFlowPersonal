import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('identity scan candidates and continuation cursor share a strict authority commit', () => {
  const syncStart = source.indexOf("async sync(trigger:")
  const statusStart = source.indexOf('getStatus(): any', syncStart)
  const body = source.slice(syncStart, statusStart)
  const scan = body.indexOf('this.runScheduledIdentityScan(createdAt)')
  const finalCommit = body.indexOf('this.saveState(true)', scan)
  const finishRun = body.indexOf('personalMemoryStore.finishIngestionRun', finalCommit)
  assert.ok(scan >= 0)
  assert.ok(finalCommit > scan)
  assert.ok(finishRun > finalCommit)
  assert.doesNotMatch(body.slice(scan, finalCommit), /this\.saveState\(\)/)
})

test('sync error persistence cannot bypass the strict identity cursor boundary', () => {
  const syncStart = source.indexOf("async sync(trigger:")
  const statusStart = source.indexOf('getStatus(): any', syncStart)
  const body = source.slice(syncStart, statusStart)
  const errorPath = body.slice(body.lastIndexOf('} catch (error: any)'))
  assert.match(errorPath, /this\.saveState\(true\)/)
  assert.doesNotMatch(errorPath, /this\.saveState\(\)/)
})
