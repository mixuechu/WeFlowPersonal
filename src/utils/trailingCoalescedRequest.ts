export class TrailingCoalescedRequest<T> {
  private active: Promise<T> | null = null
  private rerunRequested = false
  private latestWork: (() => Promise<T>) | null = null

  run(work: () => Promise<T>): Promise<T> {
    this.latestWork = work
    if (this.active) {
      this.rerunRequested = true
      return this.active
    }

    const execute = async (): Promise<T> => {
      while (true) {
        this.rerunRequested = false
        const currentWork = this.latestWork
        if (!currentWork) throw new Error('缺少刷新任务')
        let result: T | undefined
        let failed = false
        let failure: unknown
        try {
          result = await currentWork()
        } catch (error) {
          failed = true
          failure = error
        }
        if (this.rerunRequested) continue
        if (failed) throw failure
        return result as T
      }
    }

    this.active = execute().finally(() => {
      this.active = null
      this.latestWork = null
      this.rerunRequested = false
    })
    return this.active
  }
}
