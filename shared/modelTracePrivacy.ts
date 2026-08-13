export const MODEL_TRACE_PRIVACY_VERSION = 'model-trace-metadata-only-v1'

export function modelTraceContainsSensitivePayload(trace: any): boolean {
  return Boolean(
    String(trace?.systemPrompt || '').trim() ||
    String(trace?.userPrompt || '').trim() ||
    String(trace?.rawOutput || '').trim()
  )
}
export function sanitizePersistedModelTrace<T extends Record<string, any>>(trace: T): T & {
  privacyVersion: string
  sensitivePayloadRetained: false
} {
  return {
    ...trace,
    systemPrompt: '',
    userPrompt: '',
    rawOutput: '',
    privacyVersion: MODEL_TRACE_PRIVACY_VERSION,
    sensitivePayloadRetained: false
  }
}
