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
