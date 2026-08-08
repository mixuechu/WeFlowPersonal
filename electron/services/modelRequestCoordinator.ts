type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export const MODEL_RESPONSE_MAX_BYTES = 8 * 1024 * 1024

export class ModelResponseLimitError extends Error {
  readonly code = 'model_response_too_large'
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`模型响应超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 安全上限`)
    this.name = 'ModelResponseLimitError'
    this.maxBytes = maxBytes
  }
}

async function readBoundedJson(response: Response, maxBytes: number, tolerateInvalidJson: boolean): Promise<any> {
  const requestedLimit = Math.floor(Number(maxBytes))
  const normalizedLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : MODEL_RESPONSE_MAX_BYTES
  const declaredLength = Number(response.headers?.get?.('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > normalizedLimit) {
    await response.body?.cancel().catch(() => {})
    throw new ModelResponseLimitError(normalizedLimit)
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > normalizedLimit) {
          await reader.cancel().catch(() => {})
          throw new ModelResponseLimitError(normalizedLimit)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total).toString('utf8')
    try {
      return JSON.parse(body)
    } catch (error) {
      if (tolerateInvalidJson && error instanceof SyntaxError) return {}
      throw error
    }
  }

  // 测试替身或旧运行时可能只实现 json()；真实 fetch 响应始终走上方有界流。
  try {
    return await response.json()
  } catch (error) {
    if (tolerateInvalidJson && error instanceof SyntaxError) return {}
    throw error
  }
}

export class RequestCoordinator {
  private controllers = new Set<AbortController>()
  private accepting = true
  private readonly fetcher: FetchLike
  private readonly label: string

  constructor(label: string, fetcher: FetchLike = fetch) {
    this.label = label
    this.fetcher = fetcher
  }

  getStatus(): { accepting: boolean; active: number } {
    return { accepting: this.accepting, active: this.controllers.size }
  }

  async fetch(input: string | URL, init: RequestInit = {}, timeoutMs = 90_000): Promise<Response> {
    return this.runWithDeadline(
      input,
      init,
      timeoutMs,
      response => Promise.resolve(response)
    )
  }

  async fetchJson(
    input: string | URL,
    init: RequestInit = {},
    timeoutMs = 90_000,
    tolerateInvalidJson = false,
    maxResponseBytes = MODEL_RESPONSE_MAX_BYTES
  ): Promise<{ response: Response; payload: any }> {
    return this.runWithDeadline(input, init, timeoutMs, async response => {
      return { response, payload: await readBoundedJson(response, maxResponseBytes, tolerateInvalidJson) }
    })
  }

  private async runWithDeadline<T>(
    input: string | URL,
    init: RequestInit,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    if (!this.accepting) throw new Error(`AI 助理正在安全退出，不能开始新的${this.label}`)
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => {
      controller.abort(new Error(`${this.label}超过 ${Math.ceil(timeoutMs / 1000)} 秒，已安全取消`))
    }, Math.max(1, timeoutMs))
    timeout.unref?.()
    try {
      const response = await this.fetcher(input, { ...init, signal: controller.signal })
      return await consume(response)
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }

  stop(reason?: string): number {
    this.accepting = false
    const active = this.controllers.size
    for (const controller of this.controllers) {
      controller.abort(new Error(reason || `应用正在安全退出，${this.label}已取消`))
    }
    return active
  }
}

export class ModelRequestCoordinator extends RequestCoordinator {
  constructor(fetcher: FetchLike = fetch) {
    super('模型请求', fetcher)
  }
}
