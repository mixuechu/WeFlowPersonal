export const EXPORT_AVATAR_MAX_BYTES = 8 * 1024 * 1024

export type ExportAvatarMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp'

export function detectExportAvatarMime(buffer: Buffer): ExportAvatarMime | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  return null
}
