import { LatestRequestGate } from './latestRequestGate.ts'

export class KeyedLatestRequestGates {
  private gates = new Map<string, LatestRequestGate>()

  private gate(key: string): LatestRequestGate {
    let gate = this.gates.get(key)
    if (!gate) {
      gate = new LatestRequestGate()
      this.gates.set(key, gate)
    }
    return gate
  }

  begin(key: string): number {
    return this.gate(key).begin()
  }

  isCurrent(key: string, request: number): boolean {
    return this.gates.get(key)?.isCurrent(request) === true
  }

  invalidate(key: string): void {
    this.gates.get(key)?.invalidate()
    this.gates.delete(key)
  }

  invalidateAll(): void {
    for (const gate of this.gates.values()) gate.invalidate()
    this.gates.clear()
  }
}
