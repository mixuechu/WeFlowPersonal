import {
  clearLegacyBackgroundFailure,
  emptyLegacyBackgroundRetries,
  legacyBackgroundRetryDelayMs,
  normalizeLegacyBackgroundRetries,
  planLegacyBackgroundFailure,
  type LegacyBackgroundRetries,
  type LegacyBackgroundTaskKind
} from './legacyBackgroundRetryPolicy.ts'

type PersistRetries = (next: LegacyBackgroundRetries) => void

let retries = emptyLegacyBackgroundRetries()
let persistRetries: PersistRetries | null = null

export const configureLegacyBackgroundRetries = (
  initial: unknown,
  persist: PersistRetries
): void => {
  retries = normalizeLegacyBackgroundRetries(initial)
  persistRetries = persist
}

export const resetLegacyBackgroundRetryController = (): void => {
  retries = emptyLegacyBackgroundRetries()
  persistRetries = null
}

export const getLegacyBackgroundRetries = (): LegacyBackgroundRetries =>
  structuredClone(retries)

export const getLegacyBackgroundRetryDelayMs = (
  kind: LegacyBackgroundTaskKind,
  nowMs = Date.now()
): number => legacyBackgroundRetryDelayMs(retries[kind], nowMs)

const commit = (next: LegacyBackgroundRetries): void => {
  // Before assistant initialization, auxiliary services may only perform their
  // lightweight configuration pass. Never pretend a retry checkpoint is durable.
  if (!persistRetries) return
  persistRetries(next)
  retries = next
}

export const recordPersistentLegacyBackgroundFailure = (
  kind: LegacyBackgroundTaskKind,
  error: unknown,
  now = new Date()
): void => {
  const next = structuredClone(retries)
  next[kind] = planLegacyBackgroundFailure(retries[kind], error, now)
  commit(next)
}

export const recordPersistentLegacyBackgroundSuccess = (
  kind: LegacyBackgroundTaskKind,
  now = new Date()
): void => {
  if (retries[kind].failures <= 0) return
  const next = structuredClone(retries)
  next[kind] = clearLegacyBackgroundFailure(retries[kind], now)
  commit(next)
}
