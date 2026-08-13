import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildImageSemanticText,
  localImageSemanticService,
  parseImageSemanticOutput
} from '../electron/services/localImageSemanticService.ts'
import { isEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'

test('Apple Vision output is validated, localized and sorted without inventing labels', () => {
  const labels = parseImageSemanticOutput(JSON.stringify({
    labels: [
      { identifier: 'screenshot', confidence: 0.32 },
      { identifier: 'document', confidence: 0.81 },
      { identifier: 'invalid', confidence: 2 },
      { identifier: '', confidence: 0.5 }
    ]
  }))
  assert.deepEqual(labels.map(label => label.identifier), ['document', 'screenshot'])
  assert.equal(labels[0].displayName, '文档')
  assert.equal(labels[1].displayName, '截图')
})

test('image semantic text explicitly remains an unconfirmed local candidate', () => {
  const text = buildImageSemanticText([
    { identifier: 'document', displayName: '文档', confidence: 0.81 },
    { identifier: 'screenshot', displayName: '截图', confidence: 0.32 }
  ])
  assert.match(text, /Apple Vision 本地候选/)
  assert.match(text, /未经人工确认/)
  assert.match(text, /文档（document） 81%/)
  assert.match(text, /截图（screenshot） 32%/)
})

test('malformed or low-confidence Vision output produces no semantic claim', () => {
  assert.deepEqual(parseImageSemanticOutput('not-json'), [])
  assert.equal(buildImageSemanticText([
    { identifier: 'noise', displayName: 'noise', confidence: 0.01 }
  ]), '')
})

test('image semantics cache by SHA-256 with private file permissions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-image-semantics-'))
  const helper = join(directory, 'fake-vision-helper')
  const cache = join(directory, 'private', 'cache.json')
  const image = join(directory, 'image.png')
  try {
    writeFileSync(helper, `#!/bin/sh
printf '%s' '{"labels":[{"identifier":"document","confidence":0.8}]}'
`)
    chmodSync(helper, 0o755)
    writeFileSync(image, 'not-a-real-image-but-the-helper-is-controlled')
    process.env.WEFLOW_IMAGE_SEMANTIC_HELPER = helper
    localImageSemanticService.initialize(cache, randomBytes(32))
    const first = await localImageSemanticService.classify(image)
    const second = await localImageSemanticService.classify(image)
    assert.equal(first.success, true)
    assert.equal(first.cached, false)
    assert.equal(second.success, true)
    assert.equal(second.cached, true)
    assert.equal(second.labels[0].displayName, '文档')
    assert.equal(statSync(cache).mode & 0o777, 0o600)
    assert.equal(statSync(join(directory, 'private')).mode & 0o777, 0o700)
    assert.equal(isEncryptedDurableJson(readFileSync(cache)), true)
    assert.equal(readFileSync(cache, 'utf8').includes('document'), false)
  } finally {
    delete process.env.WEFLOW_IMAGE_SEMANTIC_HELPER
    rmSync(directory, { recursive: true, force: true })
  }
})
