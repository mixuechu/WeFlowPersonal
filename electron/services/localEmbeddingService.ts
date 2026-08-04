import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const LOCAL_EMBEDDING_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'
export const LOCAL_EMBEDDING_REVISION = '9507db33464b5da99a532ac26b2a251767cbc62b'
const MODEL_VERSION =
  `${LOCAL_EMBEDDING_MODEL}@${LOCAL_EMBEDDING_REVISION}:q8:mean-normalized:v1`
export const LOCAL_EMBEDDING_MANIFEST = [
  { path: 'config.json', sha256: '34fa1ea6278c257de3cc8ce7e9bdc48647b802145a9da0fc32e95db620efd04f' },
  { path: 'tokenizer.json', sha256: '3d09c84ebd10306706a79a8276b3ab736a40d8ec03251c7639f4e52c3a1a4f8e' },
  { path: 'tokenizer_config.json', sha256: '7e3bd6113f18c20975eaa8e8cc03c95b727fd83d6357f8e171e22b3736bf706d' },
  { path: 'onnx/model_quantized.onnx', sha256: '99a6e522710c00220c89f8c52e0cc5aa09d4cbb1c34c0e932eab3a9dfdc65df3' },
  { path: 'onnx/model_quantized.onnx_data', sha256: '952623481ca8beea884e3d3c9ecaf8a3c7bf1d0c21de29e970cd31af9d37a90b' }
] as const

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

export class LocalEmbeddingService {
  private cacheDirectory = ''
  private extractorPromise: Promise<any> | null = null
  private lastError = ''
  private integrity: {
    state: 'not_checked' | 'verified' | 'incomplete' | 'repaired'
    checkedAt: string
    checked: number
    missing: number
    removed: number
  } = {
    state: 'not_checked',
    checkedAt: '',
    checked: 0,
    missing: LOCAL_EMBEDDING_MANIFEST.length,
    removed: 0
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
        this.integrity = { ...result, checkedAt: new Date().toISOString() }
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
        this.integrity = { ...result, checkedAt: new Date().toISOString() }
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
