export const EXTRACTION_OUTPUT_LIMITS = {
  entities: 30,
  relations: 30,
  claims: 20,
  events: 15,
  tasks: 20
} as const

export type ExtractionOutputKind = keyof typeof EXTRACTION_OUTPUT_LIMITS

export interface ExtractionCoverage {
  version: 'extraction-coverage-v1'
  saturatedKinds: ExtractionOutputKind[]
  counts: Record<ExtractionOutputKind, number>
  limits: typeof EXTRACTION_OUTPUT_LIMITS
  saturated: boolean
  adaptivelySplit: boolean
  splitDepth: number
  attempts: number
  unresolved: boolean
}

export function inspectExtractionCoverage(
  digest: any,
  input: { adaptivelySplit?: boolean; splitDepth?: number; attempts?: number; unresolved?: boolean } = {}
): ExtractionCoverage {
  const counts = Object.fromEntries(
    Object.keys(EXTRACTION_OUTPUT_LIMITS).map(kind => [
      kind,
      Array.isArray(digest?.[kind]) ? digest[kind].length : 0
    ])
  ) as Record<ExtractionOutputKind, number>
  const saturatedKinds = (Object.keys(EXTRACTION_OUTPUT_LIMITS) as ExtractionOutputKind[])
    .filter(kind => counts[kind] >= EXTRACTION_OUTPUT_LIMITS[kind])
  return {
    version: 'extraction-coverage-v1',
    saturatedKinds,
    counts,
    limits: EXTRACTION_OUTPUT_LIMITS,
    saturated: saturatedKinds.length > 0,
    adaptivelySplit: Boolean(input.adaptivelySplit),
    splitDepth: Math.max(0, Number(input.splitDepth || 0)),
    attempts: Math.max(1, Number(input.attempts || 1)),
    unresolved: Boolean(input.unresolved)
  }
}

export function splitSaturatedAnalysisBatch(
  batch: any[],
  options: {
    messageKey: (message: any) => string
    minimumCoreSize?: number
  }
): any[][] {
  const minimumCoreSize = Math.max(1, Number(options.minimumCoreSize || 25))
  const core = (batch || []).filter(message => message.analysisScope === 'core')
  if (core.length <= minimumCoreSize) return []
  const midpoint = Math.ceil(core.length / 2)
  const partitions = [core.slice(0, midpoint), core.slice(midpoint)]
  return partitions.filter(Boolean).map(partition => {
    const coreKeys = new Set(partition.map(options.messageKey))
    return batch.map(message => ({
      ...message,
      analysisScope: coreKeys.has(options.messageKey(message)) ? 'core' : 'context'
    }))
  }).filter(partition => partition.some(message => message.analysisScope === 'core'))
}

export function accumulateExtractionAttemptMeta(...items: any[]): {
  inputTokens: number
  outputTokens: number
  durationMs: number
  attempts: number
} {
  return items.reduce((total, item) => ({
    inputTokens: total.inputTokens + Math.max(0, Number(item?.inputTokens || 0)),
    outputTokens: total.outputTokens + Math.max(0, Number(item?.outputTokens || 0)),
    durationMs: total.durationMs + Math.max(0, Number(item?.durationMs || 0)),
    attempts: total.attempts + Math.max(0, Number(item?.attempts ?? (item ? 1 : 0)))
  }), { inputTokens: 0, outputTokens: 0, durationMs: 0, attempts: 0 })
}
