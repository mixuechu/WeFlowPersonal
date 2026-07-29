import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'
const MODEL_VERSION = `${MODEL}:q8:mean-normalized:v1`

export class LocalEmbeddingService {
  private cacheDirectory = ''
  private extractorPromise: Promise<any> | null = null
  private lastError = ''

  initialize(userDataPath: string): void {
    this.cacheDirectory = join(userDataPath, 'models')
    mkdirSync(this.cacheDirectory, { recursive: true })
  }

  get modelVersion(): string {
    return MODEL_VERSION
  }

  getStatus(): any {
    return {
      model: MODEL,
      modelVersion: MODEL_VERSION,
      cacheDirectory: this.cacheDirectory,
      loaded: Boolean(this.extractorPromise) && !this.lastError,
      lastError: this.lastError
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
      this.extractorPromise = import('@huggingface/transformers').then(async ({ env, pipeline }) => {
        env.cacheDir = this.cacheDirectory
        env.allowLocalModels = true
        env.allowRemoteModels = true
        return pipeline('feature-extraction', MODEL, { dtype: 'q8' })
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
