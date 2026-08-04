import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const LOCAL_EMBEDDING_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'
export const LOCAL_EMBEDDING_REVISION = '9507db33464b5da99a532ac26b2a251767cbc62b'
const MODEL_VERSION =
  `${LOCAL_EMBEDDING_MODEL}@${LOCAL_EMBEDDING_REVISION}:q8:overlap-multivector-offsets:v3`
export const LOCAL_EMBEDDING_CHUNK_SIZE = 480
export const LOCAL_EMBEDDING_CHUNK_OVERLAP = 80
export const LOCAL_EMBEDDING_MAX_CHUNKS = 256
export const LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE = 24
export const LOCAL_EMBEDDING_MANIFEST = [
  { path: 'config.json', sha256: '34fa1ea6278c257de3cc8ce7e9bdc48647b802145a9da0fc32e95db620efd04f' },
  { path: 'tokenizer.json', sha256: '3d09c84ebd10306706a79a8276b3ab736a40d8ec03251c7639f4e52c3a1a4f8e' },
  { path: 'tokenizer_config.json', sha256: '7e3bd6113f18c20975eaa8e8cc03c95b727fd83d6357f8e171e22b3736bf706d' },
  { path: 'onnx/model_quantized.onnx', sha256: '99a6e522710c00220c89f8c52e0cc5aa09d4cbb1c34c0e932eab3a9dfdc65df3' },
  { path: 'onnx/model_quantized.onnx_data', sha256: '952623481ca8beea884e3d3c9ecaf8a3c7bf1d0c21de29e970cd31af9d37a90b' }
] as const

function preferredChunkEnd(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length
  const minimum = start + Math.floor(LOCAL_EMBEDDING_CHUNK_SIZE * 0.9)
  const window = text.slice(minimum, hardEnd)
  const boundaries = ['\n\n', '\n', '。', '！', '？', '；']
  for (const boundary of boundaries) {
    const index = window.lastIndexOf(boundary)
    if (index >= 0) return minimum + index + boundary.length
  }
  return hardEnd
}

export type EmbeddingChunk = {
  text: string
  startOffset: number
  endOffset: number
}

export function buildEmbeddingChunkDetails(input: string): EmbeddingChunk[] {
  const text = String(input || '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  if (text.length <= LOCAL_EMBEDDING_CHUNK_SIZE) {
    return [{ text, startOffset: 0, endOffset: text.length }]
  }
  const chunks: EmbeddingChunk[] = []
  let start = 0
  while (start < text.length && chunks.length < LOCAL_EMBEDDING_MAX_CHUNKS) {
    const hardEnd = Math.min(text.length, start + LOCAL_EMBEDDING_CHUNK_SIZE)
    const end = preferredChunkEnd(text, start, hardEnd)
    const raw = text.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    const chunkStart = start + leading
    const chunkEnd = end - trailing
    const chunk = text.slice(chunkStart, chunkEnd)
    if (chunk) chunks.push({ text: chunk, startOffset: chunkStart, endOffset: chunkEnd })
    if (end >= text.length) break
    const nextStart = Math.max(start + 1, end - LOCAL_EMBEDDING_CHUNK_OVERLAP)
    start = nextStart
  }
  if (start < text.length && chunks.length === LOCAL_EMBEDDING_MAX_CHUNKS) {
    const tailStart = Math.max(0, text.length - LOCAL_EMBEDDING_CHUNK_SIZE)
    const tail = text.slice(tailStart).trim()
    if (tail && chunks[chunks.length - 1]?.text !== tail) {
      const adjustedStart = text.length - text.slice(tailStart).trimStart().length
      chunks[chunks.length - 1] = {
        text: tail,
        startOffset: adjustedStart,
        endOffset: adjustedStart + tail.length
      }
    }
  }
  return chunks
}

export function buildEmbeddingChunks(input: string): string[] {
  return buildEmbeddingChunkDetails(input).map(chunk => chunk.text)
}

export function meanNormalizedEmbeddings(vectors: number[][]): number[] {
  if (!vectors.length) return []
  const dimensions = vectors[0]?.length || 0
  if (!dimensions || vectors.some(vector => vector.length !== dimensions
    || vector.some(value => !Number.isFinite(value)))) return []
  const mean = Array.from({ length: dimensions }, () => 0)
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) mean[index] += vector[index]
  }
  const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm <= 1e-12) return []
  return mean.map(value => value / norm)
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

export async function verifyModelCacheManifest(input: {
  cacheDirectory: string
  model: string
  revision: string
  manifest: ReadonlyArray<{ path: string; sha256: string }>
}): Promise<{ state: 'verified' | 'incomplete' | 'repaired'; checked: number; missing: number; removed: number }> {
  const modelRoot = join(input.cacheDirectory, ...input.model.split('/'))
  let checked = 0
  let missing = 0
  let removed = 0
  for (const entry of input.manifest) {
    const candidates = [
      join(modelRoot, input.revision, ...entry.path.split('/')),
      join(modelRoot, ...entry.path.split('/'))
    ]
    const existing = candidates.filter(candidate => existsSync(candidate))
    let valid = false
    for (const candidate of existing) {
      try {
        if (await sha256File(candidate) === entry.sha256) {
          valid = true
          checked += 1
        } else {
          unlinkSync(candidate)
          removed += 1
        }
      } catch {
        try {
          unlinkSync(candidate)
          removed += 1
        } catch {}
      }
    }
    if (!valid) missing += 1
  }
  return {
    state: removed > 0 ? 'repaired' : missing > 0 ? 'incomplete' : 'verified',
    checked,
    missing,
    removed
  }
}

export type ModelCacheIntegrityHealth = {
  state: 'not_checked' | 'verified' | 'incomplete' | 'repaired'
  checkedAt: string
  checked: number
  missing: number
  removed: number
  lastRepairAt: string
}

export function recordModelCacheIntegrity(
  previous: ModelCacheIntegrityHealth,
  result: Awaited<ReturnType<typeof verifyModelCacheManifest>>,
  checkedAt: string
): ModelCacheIntegrityHealth {
  return {
    ...result,
    checkedAt,
    removed: Math.max(0, Number(previous.removed || 0)) + Math.max(0, Number(result.removed || 0)),
    lastRepairAt: result.removed > 0 ? checkedAt : String(previous.lastRepairAt || '')
  }
}

export class LocalEmbeddingService {
  private cacheDirectory = ''
  private extractorPromise: Promise<any> | null = null
  private lastError = ''
  private integrity: ModelCacheIntegrityHealth = {
    state: 'not_checked',
    checkedAt: '',
    checked: 0,
    missing: LOCAL_EMBEDDING_MANIFEST.length,
    removed: 0,
    lastRepairAt: ''
  }

  initialize(userDataPath: string): void {
    this.cacheDirectory = join(userDataPath, 'models', 'revisions', LOCAL_EMBEDDING_REVISION)
    mkdirSync(this.cacheDirectory, { recursive: true })
  }

  get modelVersion(): string {
    return MODEL_VERSION
  }

  getStatus(): any {
    return {
      model: LOCAL_EMBEDDING_MODEL,
      revision: LOCAL_EMBEDDING_REVISION,
      modelVersion: MODEL_VERSION,
      chunking: {
        strategy: 'overlap_multivector_offsets_v3',
        chunkSize: LOCAL_EMBEDDING_CHUNK_SIZE,
        overlap: LOCAL_EMBEDDING_CHUNK_OVERLAP,
        maxChunks: LOCAL_EMBEDDING_MAX_CHUNKS,
        inferenceBatchSize: LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE
      },
      cacheDirectory: this.cacheDirectory,
      loaded: Boolean(this.extractorPromise) && !this.lastError,
      lastError: this.lastError,
      integrity: { ...this.integrity }
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const clean = texts.map(text => String(text || '').trim().slice(0, 4000))
    if (!clean.length) return []
    const extractor = await this.getExtractor()
    const tensor = await extractor(clean, { pooling: 'mean', normalize: true })
    const dimensions = Number(tensor.dims?.[tensor.dims.length - 1] || 0)
    if (!dimensions) throw new Error('本地向量模型返回了无效维度')
    const values = Array.from(tensor.data as Float32Array, Number)
    return clean.map((_, index) => values.slice(index * dimensions, (index + 1) * dimensions))
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return (await this.embedDocumentDetails(texts)).map(item => item.vector)
  }

  async embedDocumentDetails(texts: string[]): Promise<Array<{
    vector: number[]
    chunks: Array<{
      vector: number[]
      chunkHash: string
      startOffset: number
      endOffset: number
    }>
  }>> {
    const chunkSets = texts.map(buildEmbeddingChunkDetails)
    const flattened = chunkSets.flatMap(chunks => chunks.map(chunk => chunk.text))
    if (!flattened.length) return texts.map(() => ({ vector: [], chunks: [] }))
    const embedded: number[][] = []
    for (let offset = 0; offset < flattened.length; offset += LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE) {
      embedded.push(...await this.embed(
        flattened.slice(offset, offset + LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE)
      ))
    }
    let offset = 0
    return chunkSets.map(chunks => {
      const vectors = embedded.slice(offset, offset + chunks.length)
      offset += chunks.length
      return {
        vector: meanNormalizedEmbeddings(vectors),
        chunks: chunks.map((chunk, index) => ({
          vector: vectors[index],
          chunkHash: createHash('sha256').update(chunk.text).digest('hex'),
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset
        }))
      }
    })
  }

  private async getExtractor(): Promise<any> {
    if (!this.cacheDirectory) throw new Error('本地向量服务尚未初始化')
    if (!this.extractorPromise) {
      this.lastError = ''
      this.extractorPromise = verifyModelCacheManifest({
        cacheDirectory: this.cacheDirectory,
        model: LOCAL_EMBEDDING_MODEL,
        revision: LOCAL_EMBEDDING_REVISION,
        manifest: LOCAL_EMBEDDING_MANIFEST
      }).then(result => {
        this.integrity = recordModelCacheIntegrity(
          this.integrity,
          result,
          new Date().toISOString()
        )
        return import('@huggingface/transformers')
      }).then(async ({ env, pipeline }) => {
        env.cacheDir = this.cacheDirectory
        env.allowLocalModels = true
        env.allowRemoteModels = true
        const extractor = await pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL, {
          dtype: 'q8',
          revision: LOCAL_EMBEDDING_REVISION
        })
        const result = await verifyModelCacheManifest({
          cacheDirectory: this.cacheDirectory,
          model: LOCAL_EMBEDDING_MODEL,
          revision: LOCAL_EMBEDDING_REVISION,
          manifest: LOCAL_EMBEDDING_MANIFEST
        })
        this.integrity = recordModelCacheIntegrity(
          this.integrity,
          result,
          new Date().toISOString()
        )
        if (result.state !== 'verified') {
          throw new Error('固定版本本地向量模型缓存未能通过 SHA-256 完整性校验')
        }
        return extractor
      }).catch(error => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.extractorPromise = null
        throw error
      })
    }
    return this.extractorPromise
  }
}

export const localEmbeddingService = new LocalEmbeddingService()
