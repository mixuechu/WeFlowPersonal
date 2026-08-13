export class SerialWorkerRequestQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}
