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
    if (!this.accepting) throw new Error(`AI 助理正在安全退出，不能开始新的${this.label}`)
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => {
      controller.abort(new Error(`${this.label}超过 ${Math.ceil(timeoutMs / 1000)} 秒，已安全取消`))
    }, Math.max(1, timeoutMs))
    timeout.unref?.()
    try {
      return await this.fetcher(input, { ...init, signal: controller.signal })
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
