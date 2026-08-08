import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AVATAR_DOWNLOAD_MAX_BYTES,
  AVATAR_DOWNLOAD_MAX_REDIRECTS,
  isSupportedAvatarContentType,
  isSupportedAvatarImage,
  parseSafeAvatarUrl
} from '../electron/services/avatarDownloadPolicy.ts'
import { resolvePublicAddress } from '../electron/services/webSnapshotService.ts'

test('avatar URL policy accepts standard web URLs without credentials or custom ports', () => {
  assert.equal(parseSafeAvatarUrl('https://wx.qlogo.cn/mmhead/example')?.href, 'https://wx.qlogo.cn/mmhead/example')
  assert.equal(parseSafeAvatarUrl('http://example.test/avatar.png')?.protocol, 'http:')
  assert.equal(parseSafeAvatarUrl('file:///Users/private/avatar.png'), null)
  assert.equal(parseSafeAvatarUrl('https://user:pass@example.test/avatar.png'), null)
  assert.equal(parseSafeAvatarUrl('https://example.test:8443/avatar.png'), null)
  assert.equal(parseSafeAvatarUrl('not a URL'), null)
})

test('avatar response policy accepts only bounded raster formats', () => {
  assert.equal(isSupportedAvatarContentType('image/png; charset=binary'), true)
  assert.equal(isSupportedAvatarContentType('image/jpeg'), true)
  assert.equal(isSupportedAvatarContentType('image/svg+xml'), false)
  assert.equal(isSupportedAvatarContentType('text/html'), false)
  assert.equal(isSupportedAvatarImage(Buffer.from('89504e470d0a1a0a0000', 'hex')), true)
  assert.equal(isSupportedAvatarImage(Buffer.from('ffd8ffe00010', 'hex')), true)
  assert.equal(isSupportedAvatarImage(Buffer.from('GIF89a', 'ascii')), true)
  assert.equal(isSupportedAvatarImage(Buffer.from('524946460000000057454250', 'hex')), true)
  assert.equal(isSupportedAvatarImage(Buffer.from('<svg><script>', 'utf8')), false)
  assert.equal(isSupportedAvatarImage(Buffer.from('<html>login</html>', 'utf8')), false)
  assert.equal(AVATAR_DOWNLOAD_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(AVATAR_DOWNLOAD_MAX_REDIRECTS, 3)
})

test('avatar DNS pinning rejects loopback and private literal addresses', async () => {
  assert.equal(await resolvePublicAddress('127.0.0.1'), null)
  assert.equal(await resolvePublicAddress('169.254.169.254'), null)
  assert.equal(await resolvePublicAddress('192.168.1.20'), null)
  assert.equal(await resolvePublicAddress('::1'), null)
  assert.equal(await resolvePublicAddress('ff02::1'), null)
  assert.equal(await resolvePublicAddress('2001:db8::1'), null)
})
