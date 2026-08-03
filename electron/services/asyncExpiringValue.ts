export class AsyncExpiringValue<T> {
  private value: T | null = null
  private checkedAt = 0
  private valid = false
  private active: Promise<T> | null = null
  private readonly maxAgeMs: number
  private readonly now: () => number

  constructor(maxAgeMs: number, now: () => number = () => Date.now()) {
    this.maxAgeMs = maxAgeMs
    this.now = now
  }

  peek(): T | null {
    return this.value
  }

  set(value: T): T {
    this.value = value
    this.checkedAt = this.now()
    this.valid = true
    return value
  }

  invalidate(): void {
    this.valid = false
  }

  async get(loader: () => Promise<T>, force = false): Promise<T> {
    if (!force && this.valid && this.value !== null && this.now() - this.checkedAt < this.maxAgeMs) {
      return this.value
    }
    if (this.active) return this.active
    this.active = loader()
      .then(value => this.set(value))
      .finally(() => {
        this.active = null
      })
    return this.active
  }
}
