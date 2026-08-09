import type { RendererPageIncidentPayload } from '../../shared/rendererPageIncident.ts'

export type RendererPageIncidentAdmissionResult = {
  recorded: boolean
  reason: 'recorded' | 'duplicate' | 'rate_limited'
}

export class RendererPageIncidentAdmission {
  private readonly duplicateWindowMs: number
  private readonly rateWindowMs: number
  private readonly maximumPerRateWindow: number
  private recentAcceptedAt: number[] = []
  private lastAcceptedByIdentity = new Map<string, number>()

  constructor(options?: {
    duplicateWindowMs?: number
    rateWindowMs?: number
    maximumPerRateWindow?: number
  }) {
    this.duplicateWindowMs = Math.max(1_000, options?.duplicateWindowMs ?? 5 * 60_000)
    this.rateWindowMs = Math.max(1_000, options?.rateWindowMs ?? 60_000)
    this.maximumPerRateWindow = Math.max(1, Math.floor(options?.maximumPerRateWindow ?? 8))
  }

  admit(payload: RendererPageIncidentPayload, now = Date.now()): RendererPageIncidentAdmissionResult {
    const timestamp = Number.isFinite(now) ? now : Date.now()
    const rateCutoff = timestamp - this.rateWindowMs
    const duplicateCutoff = timestamp - this.duplicateWindowMs
    this.recentAcceptedAt = this.recentAcceptedAt.filter(value => value > rateCutoff)
    for (const [identity, acceptedAt] of this.lastAcceptedByIdentity) {
      if (acceptedAt <= duplicateCutoff) this.lastAcceptedByIdentity.delete(identity)
    }

    const identity = `${payload.pageKind}|${payload.errorClass}|${payload.fingerprint}`
    const previous = this.lastAcceptedByIdentity.get(identity)
    if (previous !== undefined && previous > duplicateCutoff) {
      return { recorded: false, reason: 'duplicate' }
    }
    if (this.recentAcceptedAt.length >= this.maximumPerRateWindow) {
      return { recorded: false, reason: 'rate_limited' }
    }

    this.recentAcceptedAt.push(timestamp)
    this.lastAcceptedByIdentity.set(identity, timestamp)
    return { recorded: true, reason: 'recorded' }
  }

  diagnostics(now = Date.now()): {
    acceptedInRateWindow: number
    trackedIdentities: number
    maximumPerRateWindow: number
    rateWindowMs: number
    duplicateWindowMs: number
  } {
    const timestamp = Number.isFinite(now) ? now : Date.now()
    const rateCutoff = timestamp - this.rateWindowMs
    const duplicateCutoff = timestamp - this.duplicateWindowMs
    return {
      acceptedInRateWindow: this.recentAcceptedAt.filter(value => value > rateCutoff).length,
      trackedIdentities: Array.from(this.lastAcceptedByIdentity.values())
        .filter(value => value > duplicateCutoff).length,
      maximumPerRateWindow: this.maximumPerRateWindow,
      rateWindowMs: this.rateWindowMs,
      duplicateWindowMs: this.duplicateWindowMs
    }
  }
}
