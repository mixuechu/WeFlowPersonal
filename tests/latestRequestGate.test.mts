import assert from 'node:assert/strict'
import test from 'node:test'
import { LatestRequestGate } from '../src/utils/latestRequestGate.ts'

test('latest request gate rejects a slower response after a newer query begins', () => {
  const gate = new LatestRequestGate()
  const oldQuery = gate.begin()
  const newQuery = gate.begin()
  assert.equal(gate.isCurrent(oldQuery), false)
  assert.equal(gate.isCurrent(newQuery), true)
})

test('latest request gate invalidates an in-flight response when context changes', () => {
  const gate = new LatestRequestGate()
  const request = gate.begin()
  gate.invalidate()
  assert.equal(gate.isCurrent(request), false)
})
