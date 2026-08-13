import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SNS_REMOTE_MEDIA_LIMITS,
  isValidSnsImageBuffer,
  isValidSnsMp4Buffer
} from '../electron/services/snsRemoteMediaPolicy.ts'

test('SNS remote media limits remain explicit and bounded by media class', () => {
  assert.deepEqual(SNS_REMOTE_MEDIA_LIMITS, {
    imageBytes: 32 * 1024 * 1024,
    videoBytes: 256 * 1024 * 1024,
    emojiBytes: 16 * 1024 * 1024,
    diagnosticBytes: 64 * 1024
  })
  assert.ok(SNS_REMOTE_MEDIA_LIMITS.diagnosticBytes < SNS_REMOTE_MEDIA_LIMITS.emojiBytes)
  assert.ok(SNS_REMOTE_MEDIA_LIMITS.emojiBytes < SNS_REMOTE_MEDIA_LIMITS.imageBytes)
  assert.ok(SNS_REMOTE_MEDIA_LIMITS.imageBytes < SNS_REMOTE_MEDIA_LIMITS.videoBytes)
})

test('SNS image policy accepts supported raster and Apple image containers only', () => {
  assert.equal(isValidSnsImageBuffer(Buffer.from('GIF89a', 'ascii')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('89504e470d0a1a0a', 'hex')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('ffd8ffe00000', 'hex')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('524946460000000057454250', 'hex')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('00000018667479706176696600000000', 'hex')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('00000018667479706865696300000000', 'hex')), true)
  assert.equal(isValidSnsImageBuffer(Buffer.from('<svg><script>', 'utf8')), false)
  assert.equal(isValidSnsImageBuffer(Buffer.from('<html>login</html>', 'utf8')), false)
})

test('SNS video policy requires an MP4 family ftyp header', () => {
  assert.equal(isValidSnsMp4Buffer(Buffer.from('000000186674797069736f6d', 'hex')), true)
  assert.equal(isValidSnsMp4Buffer(Buffer.from('000000186d6f6f7669736f6d', 'hex')), false)
  assert.equal(isValidSnsMp4Buffer(Buffer.from('<html>login</html>', 'utf8')), false)
})
