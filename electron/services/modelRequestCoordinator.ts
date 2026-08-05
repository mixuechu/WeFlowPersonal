type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

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
    tolerateInvalidJson = false
  ): Promise<{ response: Response; payload: any }> {
    return this.runWithDeadline(input, init, timeoutMs, async response => {
      try {
        return { response, payload: await response.json() }
      } catch (error) {
        if (tolerateInvalidJson && error instanceof SyntaxError) {
          return { response, payload: {} }
        }
        throw error
      }
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
