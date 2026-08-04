export function validateEmbeddingBatch(
  vectors: unknown,
  expectedCount: number
): { valid: boolean; dimensions: number; reason: string } {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    return { valid: false, dimensions: 0, reason: 'count_mismatch' }
  }
  const dimensions = Array.isArray(vectors[0]) ? vectors[0].length : 0
  if (dimensions <= 0) return { valid: false, dimensions: 0, reason: 'empty_vector' }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      return { valid: false, dimensions, reason: 'dimension_mismatch' }
    }
    if (vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      return { valid: false, dimensions, reason: 'non_finite_value' }
    }
    const squaredNorm = vector.reduce((sum, value) => sum + value * value, 0)
    if (!Number.isFinite(squaredNorm) || squaredNorm <= 1e-24) {
      return { valid: false, dimensions, reason: 'invalid_norm' }
    }
  }
  return { valid: true, dimensions, reason: '' }
}

export function safeCosineSimilarity(left: unknown, right: unknown): number | null {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null
  let dot = 0
  let leftSquaredNorm = 0
  let rightSquaredNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (typeof leftValue !== 'number' || !Number.isFinite(leftValue)
      || typeof rightValue !== 'number' || !Number.isFinite(rightValue)) return null
    dot += leftValue * rightValue
    leftSquaredNorm += leftValue * leftValue
    rightSquaredNorm += rightValue * rightValue
  }
  if (!Number.isFinite(dot) || !Number.isFinite(leftSquaredNorm) || !Number.isFinite(rightSquaredNorm)
    || leftSquaredNorm <= 1e-24 || rightSquaredNorm <= 1e-24) return null
  const score = dot / Math.sqrt(leftSquaredNorm * rightSquaredNorm)
  if (!Number.isFinite(score)) return null
  return Math.max(-1, Math.min(1, score))
}

export const VECTOR_QUERY_DEADLINE_MS = 5_000

export async function withVectorQueryDeadline<T>(
  operation: Promise<T>,
  timeoutMs = VECTOR_QUERY_DEADLINE_MS
): Promise<T> {
  const boundedTimeout = Math.max(1, Math.floor(Number(timeoutMs) || VECTOR_QUERY_DEADLINE_MS))
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`本地语义查询超过 ${boundedTimeout}ms，已立即回退全文检索`))
        }, boundedTimeout)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function requestVectorIndexWarmup(
  pendingCount: unknown,
  schedule: () => void
): boolean {
  const pending = Math.max(0, Math.floor(Number(pendingCount || 0)))
  if (!pending) return false
  schedule()
  return true
}

export async function runVectorIndexPass<T extends { id: string; content_hash?: string }>(input: {
  maxBatches?: number
  batchSize: number
  listCandidates: (limit: number) => T[]
  embed: (documents: T[]) => Promise<unknown>
  commit: (document: T, vector: number[]) => boolean
  commitBatch?: (items: Array<{ document: T; vector: number[] }>) => number
}): Promise<{ indexed: number; batches: number; drained: boolean }> {
  const maxBatches = Number.isFinite(input.maxBatches)
    ? Math.max(1, Math.floor(Number(input.maxBatches)))
    : Number.POSITIVE_INFINITY
  const batchSize = Math.max(1, Math.floor(Number(input.batchSize) || 1))
  let indexed = 0
  let batches = 0
  while (batches < maxBatches) {
    const documents = input.listCandidates(batchSize)
    if (!documents.length) return { indexed, batches, drained: true }
    const vectors = await input.embed(documents)
    const validation = validateEmbeddingBatch(vectors, documents.length)
    if (!validation.valid) {
      throw new Error('本地向量模型返回了数量、维度、数值或范数异常的批次，已停止补建且未写入该批')
    }
    const batch = documents.map((document, index) => ({
      document,
      vector: (vectors as number[][])[index]
    }))
    const committed = input.commitBatch
      ? Math.max(0, Math.floor(Number(input.commitBatch(batch)) || 0))
      : batch.reduce((count, item) => count + (input.commit(item.document, item.vector) ? 1 : 0), 0)
    if (committed > documents.length) {
      throw new Error('向量补建批次提交数量异常，已停止补建')
    }
    if (committed === 0) {
      throw new Error('向量补建期间文档持续变化，本批没有可安全提交的结果，稍后将重新尝试')
    }
    indexed += committed
    batches += 1
  }
  return {
    indexed,
    batches,
    drained: input.listCandidates(1).length === 0
  }
}

export type VectorIndexContinuationHealth = {
  scheduled: boolean
  runCount: number
  indexedCount: number
  failureStreak: number
  nextRetryAt: string
  lastScheduledAt: string
  lastAttemptAt: string
  lastSuccessAt: string
  lastErrorAt: string
  lastError: string
}

export const VECTOR_INDEX_RETRY_BASE_MS = 60_000
export const VECTOR_INDEX_RETRY_MAX_MS = 6 * 60 * 60_000

export function vectorIndexRetryDelayMs(failureStreak: unknown): number {
  const streak = Math.max(1, Math.floor(Number(failureStreak || 1)))
  return Math.min(VECTOR_INDEX_RETRY_MAX_MS, VECTOR_INDEX_RETRY_BASE_MS * 2 ** Math.min(20, streak - 1))
}

export function vectorIndexScheduleDelayMs(
  health: Pick<VectorIndexContinuationHealth, 'nextRetryAt'>,
  requestedDelayMs: unknown,
  nowMs = Date.now()
): number {
  const requested = Math.max(0, Math.floor(Number(requestedDelayMs || 0)))
  const retryAt = Date.parse(String(health.nextRetryAt || ''))
  return Number.isFinite(retryAt)
    ? Math.max(requested, retryAt - nowMs, 0)
    : requested
}

export function recordVectorIndexContinuation(
  current: VectorIndexContinuationHealth,
  event:
    | { type: 'scheduled' | 'started' | 'cancelled'; at: string }
    | { type: 'succeeded'; at: string; indexed?: number }
    | { type: 'failed'; at: string; error?: string }
): VectorIndexContinuationHealth {
  if (event.type === 'scheduled') {
    return { ...current, scheduled: true, lastScheduledAt: event.at }
  }
  if (event.type === 'started') {
    return {
      ...current,
      scheduled: false,
      runCount: Math.max(0, Number(current.runCount || 0)) + 1,
      nextRetryAt: '',
      lastAttemptAt: event.at
    }
  }
  if (event.type === 'cancelled') return { ...current, scheduled: false }
  if (event.type === 'succeeded') {
    return {
      ...current,
      scheduled: false,
      indexedCount: Math.max(0, Number(current.indexedCount || 0))
        + Math.max(0, Math.floor(Number(event.indexed || 0))),
      failureStreak: 0,
      nextRetryAt: '',
      lastSuccessAt: event.at,
      lastError: ''
    }
  }
  const failureStreak = Math.max(0, Math.floor(Number(current.failureStreak || 0))) + 1
  const failedAt = Date.parse(event.at)
  return {
    ...current,
    scheduled: false,
    failureStreak,
    nextRetryAt: Number.isFinite(failedAt)
      ? new Date(failedAt + vectorIndexRetryDelayMs(failureStreak)).toISOString()
      : '',
    lastErrorAt: event.at,
    lastError: String(event.error || 'unknown_vector_index_error').slice(0, 500)
  }
}

export type VectorQueryHealth = {
  fallbackCount: number
  dimensionRepairCount: number
  lastDimensionRepairAt: string
  lastFallbackAt: string
  lastSuccessAt: string
  lastError: string
}

export function recordVectorQueryOutcome(
  current: VectorQueryHealth,
  outcome: { success: boolean; at: string; error?: string; dimensionRepairs?: number }
): VectorQueryHealth {
  const dimensionRepairs = Math.max(0, Math.floor(Number(outcome.dimensionRepairs || 0)))
  const repaired = dimensionRepairs
    ? {
        dimensionRepairCount: Math.max(0, Number(current.dimensionRepairCount || 0)) + dimensionRepairs,
        lastDimensionRepairAt: outcome.at
      }
    : {
        dimensionRepairCount: Math.max(0, Number(current.dimensionRepairCount || 0)),
        lastDimensionRepairAt: String(current.lastDimensionRepairAt || '')
      }
  return outcome.success
    ? {
        ...current,
        ...repaired,
        lastSuccessAt: outcome.at,
        lastError: ''
      }
    : {
        ...current,
        ...repaired,
        fallbackCount: Math.max(0, Number(current.fallbackCount || 0)) + 1,
        lastFallbackAt: outcome.at,
        lastError: String(outcome.error || 'unknown_vector_query_error').slice(0, 500)
      }
}

export function shouldPersistVectorQueryOutcome(
  previous: VectorQueryHealth,
  outcome: { success: boolean; dimensionRepairs?: number }
): boolean {
  return !outcome.success
    || Math.max(0, Math.floor(Number(outcome.dimensionRepairs || 0))) > 0
    || Boolean(previous.lastError)
}
