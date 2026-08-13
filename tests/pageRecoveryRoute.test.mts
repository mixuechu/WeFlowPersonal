import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumePageRecoveryRoute,
  normalizePageRecoveryRoute,
  PAGE_RECOVERY_ROUTE_KEY,
  rememberPageRecoveryRoute,
  type PageRecoveryStorage
} from '../src/utils/pageRecoveryRoute.ts'

const createStorage = (): PageRecoveryStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) }
  }
}

test('page recovery accepts one bounded internal route only', () => {
  assert.equal(normalizePageRecoveryRoute('/ai-assistant?mode=review#memory-search'), '/ai-assistant?mode=review#memory-search')
  assert.equal(normalizePageRecoveryRoute('https://example.com'), null)
  assert.equal(normalizePageRecoveryRoute('//example.com/path'), null)
  assert.equal(normalizePageRecoveryRoute('/route\nsecond'), null)
  assert.equal(normalizePageRecoveryRoute(`/${'x'.repeat(2048)}`), null)
})

test('recovery route is consumed before navigation so a repeated crash cannot loop', () => {
  const storage = createStorage()
  assert.equal(rememberPageRecoveryRoute(storage, '/resources'), true)
  assert.equal(storage.values.get(PAGE_RECOVERY_ROUTE_KEY), '/resources')
  assert.equal(consumePageRecoveryRoute(storage), '/resources')
  assert.equal(consumePageRecoveryRoute(storage), null)
})

test('invalid persisted recovery state is removed without navigation', () => {
  const storage = createStorage()
  storage.values.set(PAGE_RECOVERY_ROUTE_KEY, 'https://example.com')
  assert.equal(consumePageRecoveryRoute(storage), null)
  assert.equal(storage.values.has(PAGE_RECOVERY_ROUTE_KEY), false)
})
