import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectExportAvatarMime,
  EXPORT_AVATAR_MAX_BYTES
} from '../electron/services/export/media/exportAvatarPolicy.ts'

test('exported remote avatars use an explicit memory and file bound', () => {
  assert.equal(EXPORT_AVATAR_MAX_BYTES, 8 * 1024 * 1024)
})

test('export avatar MIME detection trusts supported file signatures only', () => {
  assert.equal(detectExportAvatarMime(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png')
  assert.equal(detectExportAvatarMime(Buffer.from('ffd8ffe00000', 'hex')), 'image/jpeg')
  assert.equal(detectExportAvatarMime(Buffer.from('GIF89a', 'ascii')), 'image/gif')
  assert.equal(detectExportAvatarMime(Buffer.from('524946460000000057454250', 'hex')), 'image/webp')
  assert.equal(detectExportAvatarMime(Buffer.from('424d0000', 'hex')), 'image/bmp')
  assert.equal(detectExportAvatarMime(Buffer.from('<svg><script>', 'utf8')), null)
  assert.equal(detectExportAvatarMime(Buffer.from('<html>login</html>', 'utf8')), null)
})
