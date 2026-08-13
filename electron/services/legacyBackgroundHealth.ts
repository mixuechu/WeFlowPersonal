import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'

export type LegacyBackgroundHealth = {
  version: 'legacy-background-health-v1'
  lastSuccessAt: string
  lastErrorAt: string
  lastError: string
  consecutiveFailures: number
}

export const emptyLegacyBackgroundHealth = (): LegacyBackgroundHealth => ({
  version: 'legacy-background-health-v1',
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
  consecutiveFailures: 0
})

export const recordLegacyBackgroundSuccess = (
  _current: LegacyBackgroundHealth,
  now = new Date()
): LegacyBackgroundHealth => ({
  ...emptyLegacyBackgroundHealth(),
  lastSuccessAt: now.toISOString()
})

export const recordLegacyBackgroundFailure = (
  current: LegacyBackgroundHealth,
  error: unknown,
  now = new Date()
): LegacyBackgroundHealth => ({
  ...current,
  lastErrorAt: now.toISOString(),
  lastError: sanitizeDiagnosticText(error).slice(0, 500),
  consecutiveFailures: Math.min(1_000_000, Math.max(0, Number(current.consecutiveFailures || 0)) + 1)
})
