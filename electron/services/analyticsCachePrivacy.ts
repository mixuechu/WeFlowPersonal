import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'

export const ANALYTICS_CACHE_PRIVACY_VERSION = 'analytics-memory-only-v1'

export type AnalyticsCachePrivacyStatus = {
  version: typeof ANALYTICS_CACHE_PRIVACY_VERSION
  persistence: 'memory_only'
  legacyFilePresent: boolean
  removedThisStart: boolean
  error: string
}

export function emptyAnalyticsCachePrivacyStatus(): AnalyticsCachePrivacyStatus {
  return {
    version: ANALYTICS_CACHE_PRIVACY_VERSION,
    persistence: 'memory_only',
    legacyFilePresent: false,
    removedThisStart: false,
    error: ''
  }
}

function boundedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

export async function removeLegacyAnalyticsCacheFile(
  filePath: string
): Promise<AnalyticsCachePrivacyStatus> {
  const status = emptyAnalyticsCachePrivacyStatus()
  if (!filePath) return status
  try {
    const existed = existsSync(filePath)
    await rm(filePath, { force: true })
    return { ...status, removedThisStart: existed }
  } catch (error) {
    return {
      ...status,
      legacyFilePresent: existsSync(filePath),
      error: boundedError(error)
    }
  }
}
