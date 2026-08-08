export const AVATAR_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_DOWNLOAD_MAX_REDIRECTS = 3
export const AVATAR_DOWNLOAD_TIMEOUT_MS = 10_000

export const parseSafeAvatarUrl = (value: unknown): URL | null => {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    if (url.hash) url.hash = ''
    const defaultPort = url.protocol === 'https:' ? '443' : '80'
    if (url.port && url.port !== defaultPort) return null
    return url
  } catch {
    return null
  }
}

export const isSupportedAvatarContentType = (value: unknown): boolean => {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase()
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)
}

export const isSupportedAvatarImage = (buffer: Buffer): boolean => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return true
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return true
  }
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}
