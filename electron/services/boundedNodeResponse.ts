import type { IncomingMessage } from 'node:http'

export const LEGACY_MODEL_RESPONSE_MAX_BYTES = 8 * 1024 * 1024

export class BoundedResponseError extends Error {
  readonly code = 'response_too_large'
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`模型响应超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 安全上限`)
    this.name = 'BoundedResponseError'
    this.maxBytes = maxBytes
  }
}

export async function readBoundedIncomingMessage(
  response: Pick<IncomingMessage, 'headers' | 'on' | 'destroy'>,
  maxBytes = LEGACY_MODEL_RESPONSE_MAX_BYTES
): Promise<string> {
  const requestedLimit = Math.floor(Number(maxBytes))
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : LEGACY_MODEL_RESPONSE_MAX_BYTES
  const declaredLength = Number(response.headers?.['content-length'] || 0)
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    response.destroy()
    throw new BoundedResponseError(limit)
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    response.on('data', chunk => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > limit) {
        const error = new BoundedResponseError(limit)
        response.destroy(error)
        fail(error)
        return
      }
      chunks.push(buffer)
    })
    response.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, total).toString('utf8'))
    })
    response.on('error', error => fail(error instanceof Error ? error : new Error('response_error')))
    response.on('aborted', () => fail(new Error('response_aborted')))
  })
}
