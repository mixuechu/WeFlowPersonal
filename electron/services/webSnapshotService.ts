import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

export type WebSnapshotResult = {
  success: boolean
  status: 'indexed' | 'unsafe_url' | 'not_html' | 'too_large' | 'timeout' | 'failed'
  url: string
  finalUrl?: string
  title?: string
  description?: string
  text?: string
  error?: string
}

const MAX_BYTES = 512 * 1024
const MAX_TEXT_CHARS = 16_000
const TIMEOUT_MS = 8_000

export function isSafePublicAddress(address: string): boolean {
  if (!isIP(address)) return false
  if (address.includes(':')) {
    const value = address.toLowerCase()
    if (value === '::' || value === '::1' || value.startsWith('fe8') || value.startsWith('fe9') ||
      value.startsWith('fea') || value.startsWith('feb') || value.startsWith('fc') || value.startsWith('fd')) return false
    if (value.startsWith('::ffff:')) return isSafePublicAddress(value.slice(7))
    return true
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

export function extractWebSnapshotText(html: string): { title: string; description: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ').trim().slice(0, 300)
  const descriptionMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)
  const description = decodeEntities(descriptionMatch?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 1_000)
  const text = decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<\/(?:p|div|article|section|main|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
  return { title, description, text }
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number } | null> {
  if (isIP(hostname)) return isSafePublicAddress(hostname) ? { address: hostname, family: isIP(hostname) } : null
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  const syntheticProxyAddresses = addresses.length > 0 && addresses.every(item => {
    if (item.family !== 4) return false
    const [a, b] = item.address.split('.').map(Number)
    return a === 198 && (b === 18 || b === 19)
  })
  if (syntheticProxyAddresses) {
    const verified = await resolvePublicAddressViaDoh(hostname)
    return verified ? addresses[0] : null
  }
  if (!addresses.length || addresses.some(item => !isSafePublicAddress(item.address))) return null
  return addresses[0]
}

async function resolvePublicAddressViaDoh(hostname: string): Promise<boolean> {
  const query = async (type: 'A' | 'AAAA'): Promise<string[]> => new Promise((resolve, reject) => {
    const request = https.request({
      hostname: '1.1.1.1',
      servername: 'cloudflare-dns.com',
      port: 443,
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      headers: { Host: 'cloudflare-dns.com', Accept: 'application/dns-json' },
      timeout: 4_000
    }, response => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > 64 * 1024) request.destroy(new Error('doh_too_large'))
        else chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve((payload.Answer || []).map((item: any) => String(item.data || '')).filter(value => isIP(value)))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('doh_timeout')))
    request.on('error', reject)
    request.end()
  })
  try {
    const addresses = [...await query('A'), ...await query('AAAA')]
    return addresses.length > 0 && addresses.every(isSafePublicAddress)
  } catch {
    return false
  }
}

async function requestPage(url: URL): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const resolved = await resolvePublicAddress(url.hostname)
  if (!resolved) throw Object.assign(new Error('unsafe_url'), { code: 'UNSAFE_URL' })
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.hostname,
      headers: {
        Host: url.host,
        'User-Agent': 'WeFlow-Personal-OS/5.1 (+local-link-indexer)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8'
      },
      timeout: TIMEOUT_MS
    }, response => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > MAX_BYTES) {
          request.destroy(Object.assign(new Error('too_large'), { code: 'TOO_LARGE' }))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    request.on('error', reject)
    request.end()
  })
}

function isAllowedWebUrl(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  return !url.port || (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
}

export async function captureWebSnapshot(input: string): Promise<WebSnapshotResult> {
  let current: URL
  try {
    current = new URL(input)
    if (!isAllowedWebUrl(current)) throw new Error('unsafe')
  } catch {
    return { success: false, status: 'unsafe_url', url: input }
  }
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await requestPage(current)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        current = new URL(response.headers.location, current)
        if (!isAllowedWebUrl(current)) {
          return { success: false, status: 'unsafe_url', url: input }
        }
        continue
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase()
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
        return { success: false, status: 'not_html', url: input, finalUrl: current.href }
      }
      const parsed = extractWebSnapshotText(response.body.toString('utf8'))
      if (!parsed.text) return { success: false, status: 'failed', url: input, finalUrl: current.href }
      return { success: true, status: 'indexed', url: input, finalUrl: current.href, ...parsed }
    }
    return { success: false, status: 'failed', url: input, error: 'redirect_limit' }
  } catch (error: any) {
    const status = error?.code === 'UNSAFE_URL' ? 'unsafe_url'
      : error?.code === 'TOO_LARGE' ? 'too_large'
        : error?.code === 'TIMEOUT' ? 'timeout' : 'failed'
    return { success: false, status, url: input, error: String(error?.message || error) }
  }
}

export const WEB_SNAPSHOT_LIMITS = { maxBytes: MAX_BYTES, maxTextChars: MAX_TEXT_CHARS, timeoutMs: TIMEOUT_MS, redirects: 3 }
