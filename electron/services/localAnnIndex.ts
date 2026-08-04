import { createHash } from 'node:crypto'

export const LOCAL_ANN_INDEX_VERSION = 'lsh-multivector-v2'
export const LOCAL_ANN_DEFAULT_TABLES = 6
export const LOCAL_ANN_DEFAULT_BITS = 8
export const LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS = 2_000

const modelSeed = (model: string): number => createHash('sha256')
  .update(`${LOCAL_ANN_INDEX_VERSION}\0${model}`)
  .digest()
  .readUInt32LE(0)

const mix32 = (value: number): number => {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

const projectionSign = (seed: number, table: number, bit: number, dimension: number): number =>
  (mix32(seed ^ Math.imul(table + 1, 0x9e3779b1) ^ Math.imul(bit + 1, 0x85ebca6b) ^
    Math.imul(dimension + 1, 0xc2b2ae35)) & 1) === 0 ? -1 : 1

export const computeAnnSignature = (
  vector: number[],
  model: string,
  table: number,
  bits = LOCAL_ANN_DEFAULT_BITS
): number => {
  let signature = 0
  const seed = modelSeed(model)
  for (let bit = 0; bit < bits; bit += 1) {
    let projection = 0
    for (let dimension = 0; dimension < vector.length; dimension += 1) {
      projection += Number(vector[dimension] || 0) * projectionSign(seed, table, bit, dimension)
    }
    if (projection >= 0) signature |= (1 << bit)
  }
  return signature
}

export const computeAnnSignatures = (
  vector: number[],
  model: string,
  tables = LOCAL_ANN_DEFAULT_TABLES,
  bits = LOCAL_ANN_DEFAULT_BITS
): number[] => Array.from({ length: tables }, (_, table) =>
  computeAnnSignature(vector, model, table, bits))

export const listMultiProbeSignatures = (signature: number, bits = LOCAL_ANN_DEFAULT_BITS): number[] => [
  signature,
  ...Array.from({ length: bits }, (_, bit) => signature ^ (1 << bit))
]
