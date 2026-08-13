export interface StaleReloadDecision {
  retry: boolean
  attempt: number
  delayMs: number
}

export class BoundedStaleReloadTracker {
  private readonly attempts = new Map<string, { scope: string; count: number }>()
  private readonly maximumStaleResults: number
  private readonly baseDelayMs: number

  constructor(maximumStaleResults = 3, baseDelayMs = 250) {
    this.maximumStaleResults = maximumStaleResults
    this.baseDelayMs = baseDelayMs
  }

  next(key: string, scope: string): StaleReloadDecision {
    const previous = this.attempts.get(key)
    const count = previous?.scope === scope ? previous.count + 1 : 1
    if (count >= this.maximumStaleResults) {
      this.attempts.delete(key)
      return { retry: false, attempt: count, delayMs: 0 }
    }
    this.attempts.set(key, { scope, count })
    return {
      retry: true,
      attempt: count,
      delayMs: this.baseDelayMs * count
    }
  }

  clear(key: string): void {
    this.attempts.delete(key)
  }
}
