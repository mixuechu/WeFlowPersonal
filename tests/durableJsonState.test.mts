import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDurableJson, writeDurableJson } from '../electron/services/durableJsonState.ts'

test('durable JSON recovers a corrupted primary from the last known-good snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-durable-state-'))
  const path = join(directory, 'state.json')
  writeDurableJson(path, { generation: 1, tasks: ['first'] })
  writeDurableJson(path, { generation: 2, tasks: ['second'] })
  writeFileSync(path, '{"generation":', { mode: 0o600 })

  const recovered = readDurableJson(path, { generation: 0, tasks: [] as string[] })
  assert.deepEqual(recovered.value, { generation: 1, tasks: ['first'] })
  assert.equal(recovered.recovery.source, 'backup')
  assert.equal(recovered.recovery.recovered, true)
  assert.equal(recovered.recovery.repairedPrimary, true)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), recovered.value)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(statSync(`${path}.bak`).mode & 0o777, 0o600)
})

test('durable JSON ignores an incomplete temporary write and keeps the committed primary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-durable-state-'))
  const path = join(directory, 'state.json')
  writeDurableJson(path, { cursor: 42 })
  writeFileSync(`${path}.tmp`, '{"cursor": 99', { mode: 0o600 })

  const loaded = readDurableJson(path, { cursor: 0 })
  assert.deepEqual(loaded.value, { cursor: 42 })
  assert.equal(loaded.recovery.source, 'primary')
  assert.equal(loaded.recovery.recovered, false)
})

test('durable JSON uses the explicit empty fallback only when both copies are unusable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-durable-state-'))
  const path = join(directory, 'state.json')
  writeFileSync(path, '{bad', { mode: 0o600 })
  writeFileSync(`${path}.bak`, '{also bad', { mode: 0o600 })

  const loaded = readDurableJson(path, { safe: true })
  assert.deepEqual(loaded.value, { safe: true })
  assert.equal(loaded.recovery.source, 'empty')
  assert.match(loaded.recovery.primaryError, /SyntaxError/)
  assert.match(loaded.recovery.backupError, /SyntaxError/)
})
