export const SNS_REMOTE_MEDIA_LIMITS = Object.freeze({
  imageBytes: 32 * 1024 * 1024,
  videoBytes: 256 * 1024 * 1024,
  emojiBytes: 16 * 1024 * 1024,
  diagnosticBytes: 64 * 1024
})

export function isValidSnsMp4Buffer(buffer: Buffer): boolean {
  return Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
}

export function isValidSnsImageBuffer(buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return true
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return true
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return true
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false
  const brands = buffer.subarray(8, Math.min(buffer.length, 64)).toString('ascii').toLowerCase()
  return ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].some(brand => brands.includes(brand))
}
