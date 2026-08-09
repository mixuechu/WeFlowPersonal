import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, type ChildProcess } from 'node:child_process'
import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'

export const LOCAL_EMBEDDING_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'
export const LOCAL_EMBEDDING_REVISION = '9507db33464b5da99a532ac26b2a251767cbc62b'
const MODEL_VERSION =
  `${LOCAL_EMBEDDING_MODEL}@${LOCAL_EMBEDDING_REVISION}:q8:overlap-multivector-offsets:v3`
export const LOCAL_EMBEDDING_CHUNK_SIZE = 480
export const LOCAL_EMBEDDING_CHUNK_OVERLAP = 80
export const LOCAL_EMBEDDING_MAX_CHUNKS = 256
export const LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE = 24
export const LOCAL_EMBEDDING_IDLE_UNLOAD_MS = 2 * 60_000
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

type EmbeddingWorkerMessage = {
  type: 'ready' | 'result' | 'disposed' | 'error'
  id?: number
  vectors?: number[][]
  error?: string
  runtimeMemory?: {
    rssBytes?: number
    heapUsedBytes?: number
    externalBytes?: number
  }
}

export type LocalEmbeddingRuntimeMemory = {
  pid: number
  rssBytes: number
  heapUsedBytes: number
  externalBytes: number
}

export class LocalEmbeddingWorkerClient {
  private readonly worker: ChildProcess
  private readonly pending = new Map<number, {
    resolve: (value: number[][]) => void
    reject: (error: Error) => void
  }>()
  private readonly readyPromise: Promise<void>
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private nextId = 1
  private exited = false
  private runtimeMemory: LocalEmbeddingRuntimeMemory | null = null

  constructor(cacheDirectory: string, workerPathOverride = '') {
    let workerPath = workerPathOverride
    if (!workerPath) {
      const moduleDirectory = dirname(fileURLToPath(import.meta.url))
      const developmentPath = join(moduleDirectory, '../dist-electron/localEmbeddingWorker.js')
      const packagedPath = join(moduleDirectory, 'localEmbeddingWorker.js')
      workerPath = process.env.NODE_ENV === 'development' && existsSync(developmentPath)
        ? developmentPath
        : packagedPath
    }
    if (!existsSync(workerPath)) throw new Error('本地向量隔离 worker 不存在')
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.worker = fork(workerPath, [], {
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced'
    })
    this.worker.on('message', message => this.handleMessage(message as EmbeddingWorkerMessage))
    this.worker.on('error', error => this.handleExit(error))
    this.worker.on('exit', code => this.handleExit(
      code === 0 ? null : new Error(`本地向量隔离 worker 异常退出（${code}）`)
    ))
    this.worker.send({
      type: 'initialize',
      cacheDirectory,
      model: LOCAL_EMBEDDING_MODEL,
      revision: LOCAL_EMBEDDING_REVISION
    })
  }

  async ready(): Promise<void> {
    return this.readyPromise
  }

  getRuntimeMemory(): LocalEmbeddingRuntimeMemory | null {
    return this.runtimeMemory ? { ...this.runtimeMemory } : null
  }

  async embed(texts: string[]): Promise<{ dims: number[]; data: Float32Array }> {
    await this.readyPromise
    if (this.exited) throw new Error('本地向量隔离 worker 已退出')
    const id = this.nextId++
    const vectors = await new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker.send({ type: 'embed', id, texts })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    const dimensions = vectors[0]?.length || 0
    return {
      dims: [vectors.length, dimensions],
      data: Float32Array.from(vectors.flat())
    }
  }

  async dispose(): Promise<void> {
    if (this.exited) return
    const id = this.nextId++
    const graceful = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2_000)
      timer.unref?.()
      this.pending.set(id, {
        resolve: () => { clearTimeout(timer); resolve() },
        reject: () => { clearTimeout(timer); resolve() }
      })
    })
    try { this.worker.send({ type: 'dispose', id }) } catch {}
    await graceful
    this.exited = true
    this.rejectPending(new Error('本地向量隔离 worker 已释放'))
    try { if (!this.worker.killed) this.worker.kill('SIGTERM') } catch {}
  }

  private handleMessage(message: EmbeddingWorkerMessage): void {
    const pid = Number(this.worker.pid || 0)
    if (pid > 0 && message.runtimeMemory) {
      this.runtimeMemory = {
        pid,
        rssBytes: Math.max(0, Number(message.runtimeMemory.rssBytes || 0)),
        heapUsedBytes: Math.max(0, Number(message.runtimeMemory.heapUsedBytes || 0)),
        externalBytes: Math.max(0, Number(message.runtimeMemory.externalBytes || 0))
      }
    }
    if (message.type === 'ready') {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }
    const id = Number(message.id || 0)
    if (message.type === 'error' && !id) {
      const failure = new Error(String(message.error || '本地向量 worker 初始化失败'))
      this.readyReject?.(failure)
      this.readyResolve = null
      this.readyReject = null
      return
    }
    const task = this.pending.get(id)
    if (!task) return
    this.pending.delete(id)
    if (message.type === 'result') task.resolve(Array.isArray(message.vectors) ? message.vectors : [])
    else if (message.type === 'disposed') task.resolve([])
    else task.reject(new Error(String(message.error || '本地向量 worker 执行失败')))
  }

  private handleExit(error: Error | null): void {
    if (this.exited) return
    this.exited = true
    this.runtimeMemory = null
    const failure = error || new Error('本地向量隔离 worker 提前退出')
    this.readyReject?.(failure)
    this.readyResolve = null
    this.readyReject = null
    this.rejectPending(failure)
  }

  private rejectPending(error: Error): void {
    for (const task of this.pending.values()) task.reject(error)
    this.pending.clear()
  }
}

async function createIsolatedEmbeddingExtractor(cacheDirectory: string): Promise<any> {
  const client = new LocalEmbeddingWorkerClient(cacheDirectory)
  try {
    await client.ready()
  } catch (error) {
    await client.dispose()
    throw error
  }
  const extractor: any = (texts: string[]) => client.embed(texts)
  extractor.dispose = () => client.dispose()
  extractor.getRuntimeMemory = () => client.getRuntimeMemory()
  return extractor
}

export class LocalEmbeddingService {
  private cacheDirectory = ''
  private readonly extractorLoader: (() => Promise<any>) | null
  private readonly idleUnloadMs: number
  private extractorPromise: Promise<any> | null = null
  private loadedExtractor: any = null
  private activeInferences = 0
  private idleUnloadTimer: ReturnType<typeof setTimeout> | null = null
  private extractorResetRequested = false
  private unloadCount = 0
  private lastLoadedAt = ''
  private lastUnloadedAt = ''
  private lastUnloadError = ''
  private lastError = ''
  private integrity: ModelCacheIntegrityHealth = {
    state: 'not_checked',
    checkedAt: '',
    checked: 0,
    missing: LOCAL_EMBEDDING_MANIFEST.length,
    removed: 0,
    lastRepairAt: ''
  }

  constructor(
    extractorLoader: (() => Promise<any>) | null = null,
    idleUnloadMs = LOCAL_EMBEDDING_IDLE_UNLOAD_MS
  ) {
    this.extractorLoader = extractorLoader
    this.idleUnloadMs = idleUnloadMs
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
      runtime: this.extractorLoader ? 'in_process_test' : 'isolated_process',
      loaded: Boolean(this.extractorPromise) && !this.lastError,
      activeInferences: this.activeInferences,
      idleUnloadScheduled: Boolean(this.idleUnloadTimer),
      idleUnloadMs: this.idleUnloadMs,
      unloadCount: this.unloadCount,
      lastLoadedAt: this.lastLoadedAt,
      lastUnloadedAt: this.lastUnloadedAt,
      lastUnloadError: this.lastUnloadError,
      lastError: this.lastError,
      integrity: { ...this.integrity }
    }
  }

  getRuntimeProcessMemory(): LocalEmbeddingRuntimeMemory | null {
    // The resolved extractor is mirrored without awaiting so a diagnostics refresh
    // never blocks on model download or initialization.
    return this.loadedExtractor?.getRuntimeMemory?.() || null
  }

  async embed(texts: string[]): Promise<number[][]> {
    const clean = texts.map(text => String(text || '').trim().slice(0, 4000))
    if (!clean.length) return []
    this.cancelIdleUnload()
    this.activeInferences += 1
    try {
      const extractor = await this.getExtractor()
      const tensor = await extractor(clean, { pooling: 'mean', normalize: true })
      const dimensions = Number(tensor.dims?.[tensor.dims.length - 1] || 0)
      if (!dimensions) throw new Error('本地向量模型返回了无效维度')
      const values = Array.from(tensor.data as Float32Array, Number)
      return clean.map((_, index) => values.slice(index * dimensions, (index + 1) * dimensions))
    } catch (error) {
      this.lastError = sanitizeDiagnosticText(error)
      this.extractorResetRequested = true
      throw error
    } finally {
      this.activeInferences = Math.max(0, this.activeInferences - 1)
      if (this.activeInferences === 0 && this.extractorResetRequested) {
        this.extractorResetRequested = false
        await this.unloadExtractor()
      } else {
        this.scheduleIdleUnload()
      }
    }
  }

  async dispose(): Promise<void> {
    this.cancelIdleUnload()
    if (this.activeInferences > 0) return
    await this.unloadExtractor()
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
      const loading = this.extractorLoader
        ? this.extractorLoader()
        : verifyModelCacheManifest({
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
        return createIsolatedEmbeddingExtractor(this.cacheDirectory)
      }).then(async extractor => {
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
          if (typeof extractor?.dispose === 'function') await extractor.dispose()
          throw new Error('固定版本本地向量模型缓存未能通过 SHA-256 完整性校验')
        }
        return extractor
      })
      this.extractorPromise = loading.then(extractor => {
        this.loadedExtractor = extractor
        this.lastLoadedAt = new Date().toISOString()
        return extractor
      }).catch(error => {
        this.lastError = sanitizeDiagnosticText(error)
        this.extractorPromise = null
        this.loadedExtractor = null
        throw error
      })
    }
    return this.extractorPromise
  }

  private cancelIdleUnload(): void {
    if (this.idleUnloadTimer) clearTimeout(this.idleUnloadTimer)
    this.idleUnloadTimer = null
  }

  private scheduleIdleUnload(): void {
    if (this.activeInferences > 0 || !this.extractorPromise || this.idleUnloadTimer) return
    this.idleUnloadTimer = setTimeout(() => {
      this.idleUnloadTimer = null
      if (this.activeInferences > 0) {
        this.scheduleIdleUnload()
        return
      }
      void this.unloadExtractor()
    }, Math.max(0, this.idleUnloadMs))
    this.idleUnloadTimer.unref?.()
  }

  private async unloadExtractor(): Promise<void> {
    if (this.activeInferences > 0 || !this.extractorPromise) return
    const unloading = this.extractorPromise
    this.extractorPromise = null
    this.loadedExtractor = null
    try {
      const extractor = await unloading
      if (typeof extractor?.dispose === 'function') await extractor.dispose()
      this.unloadCount += 1
      this.lastUnloadedAt = new Date().toISOString()
      this.lastUnloadError = ''
    } catch (error) {
      this.lastUnloadError = error instanceof Error ? error.message : String(error)
    }
  }
}

export const localEmbeddingService = new LocalEmbeddingService()
