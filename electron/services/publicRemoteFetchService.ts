import http, { type IncomingHttpHeaders } from 'node:http'
import https from 'node:https'
import { resolvePublicAddress } from './webSnapshotService.ts'

export const PUBLIC_REMOTE_FETCH_MAX_REDIRECTS = 3
export const PUBLIC_REMOTE_FETCH_TIMEOUT_MS = 15_000

export type PublicRemoteFetchResult = {
  body: Buffer
  finalUrl: string
  headers: IncomingHttpHeaders
  statusCode: number
}

export type PublicRemoteFetchOptions = {
  maxBytes: number
  maxRedirects?: number
  timeoutMs?: number
  headers?: Record<string, string>
}

export class PublicRemoteFetchError extends Error {
  readonly code: 'invalid_url' | 'unsafe_url' | 'redirect_limit' | 'too_large' | 'timeout' | 'http_error' | 'network_error'

  constructor(
    code: 'invalid_url' | 'unsafe_url' | 'redirect_limit' | 'too_large' | 'timeout' | 'http_error' | 'network_error',
    message = code
  ) {
    super(message)
    this.name = 'PublicRemoteFetchError'
    this.code = code
  }
}

export function parsePublicRemoteUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    if (url.port && !(
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    )) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

export function detectSupportedRasterExtension(buffer: Buffer): '.gif' | '.png' | '.jpg' | '.webp' | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return '.gif'
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return '.webp'
  return null
}

async function requestOnce(url: URL, options: Required<Pick<PublicRemoteFetchOptions, 'maxBytes' | 'timeoutMs'>> & Pick<PublicRemoteFetchOptions, 'headers'>): Promise<PublicRemoteFetchResult> {
  const resolved = await resolvePublicAddress(url.hostname).catch(() => null)
  if (!resolved) throw new PublicRemoteFetchError('unsafe_url')
  const client = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    let settled = false
    const finishReject = (error: PublicRemoteFetchError) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const request = client.request({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
      headers: {
        ...options.headers,
        Host: url.host,
        'Accept-Encoding': 'identity'
      }
    }, response => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', chunk => {
        if (settled) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buffer.length
        if (total > options.maxBytes) {
          response.destroy()
          request.destroy()
          finishReject(new PublicRemoteFetchError('too_large'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        resolve({
          body: Buffer.concat(chunks),
          finalUrl: url.href,
          headers: response.headers,
          statusCode: response.statusCode || 0
        })
      })
      response.on('error', () => finishReject(new PublicRemoteFetchError('network_error')))
    })
    request.setTimeout(options.timeoutMs, () => {
      request.destroy()
      finishReject(new PublicRemoteFetchError('timeout'))
    })
    request.on('error', () => finishReject(new PublicRemoteFetchError('network_error')))
    request.end()
  })
}

export async function fetchPublicRemoteBuffer(input: unknown, options: PublicRemoteFetchOptions): Promise<PublicRemoteFetchResult> {
  const maxBytes = Math.floor(Number(options.maxBytes))
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new PublicRemoteFetchError('too_large', 'invalid_max_bytes')
  }
  const maxRedirects = Math.max(0, Math.min(10, Math.floor(options.maxRedirects ?? PUBLIC_REMOTE_FETCH_MAX_REDIRECTS)))
  const timeoutMs = Math.max(1_000, Math.min(120_000, Math.floor(options.timeoutMs ?? PUBLIC_REMOTE_FETCH_TIMEOUT_MS)))
  let current = parsePublicRemoteUrl(input)
  if (!current) throw new PublicRemoteFetchError('invalid_url')

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const result = await requestOnce(current, { maxBytes, timeoutMs, headers: options.headers })
    if (result.statusCode >= 300 && result.statusCode < 400 && result.headers.location) {
      if (redirects >= maxRedirects) throw new PublicRemoteFetchError('redirect_limit')
      const redirected = parsePublicRemoteUrl(new URL(result.headers.location, current).href)
      if (!redirected) throw new PublicRemoteFetchError('invalid_url')
      current = redirected
      continue
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new PublicRemoteFetchError('http_error', `http_${result.statusCode}`)
    }
    return result
  }
  throw new PublicRemoteFetchError('redirect_limit')
}
