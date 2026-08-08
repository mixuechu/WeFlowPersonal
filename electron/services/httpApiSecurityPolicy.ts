import { isIP } from 'net'

export const HTTP_API_MIN_TOKEN_LENGTH = 16
export const HTTP_API_MAX_TOKEN_LENGTH = 512

export const normalizeHttpApiBindHost = (value: unknown): string | null => {
  const host = String(value || '').trim().toLowerCase()
  if (host === 'localhost') return '127.0.0.1'
  if (host === '127.0.0.1' || host === '0.0.0.0') return host
  // Explicit IPs are deterministic. Hostnames are rejected to avoid DNS
  // rebinding and accidental binding to an unexpected interface.
  return isIP(host) === 4 ? host : null
}

export const normalizeHttpApiPort = (value: unknown): number | null => {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) return null
  return port
}

export const isValidHttpApiToken = (value: unknown): boolean => {
  const token = String(value || '').trim()
  return token.length >= HTTP_API_MIN_TOKEN_LENGTH
    && token.length <= HTTP_API_MAX_TOKEN_LENGTH
    && !/[\r\n]/.test(token)
}

export const extractBearerToken = (header: string | string[] | undefined): string => {
  if (typeof header !== 'string') return ''
  const match = header.match(/^Bearer[ \t]+([^\s,]+)$/i)
  return match ? match[1] : ''
}
