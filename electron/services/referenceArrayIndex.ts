export class ReferenceArrayIndex<T> {
  private source: T[] | null = null
  private index = new Map<string, T>()
  private buildCount = 0
  private readonly identity: (item: T) => string

  constructor(identity: (item: T) => string) {
    this.identity = identity
  }

  get(items: T[]): Map<string, T> {
    if (this.source !== items || this.index.size !== items.length) {
      this.index = new Map(items.map(item => [this.identity(item), item]))
      this.source = items
      this.buildCount += 1
    }
    return this.index
  }

  stats(items: T[]): { builds: number; indexedItems: number; current: boolean } {
    const current = this.source === items && this.index.size === items.length
    return {
      builds: this.buildCount,
      indexedItems: current ? this.index.size : 0,
      current
    }
  }
}
