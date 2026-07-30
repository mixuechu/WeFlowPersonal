import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MODEL_VERSION = 'apple-vision-classify-v1'

export type LocalImageSemanticLabel = {
  identifier: string
  displayName: string
  confidence: number
}

export type LocalImageSemanticResult = {
  success: boolean
  labels: LocalImageSemanticLabel[]
  cached?: boolean
  error?: string
}

const localizedLabels: Record<string, string> = {
  animal: '动物',
  building: '建筑',
  car: '汽车',
  chart: '图表',
  computer: '电脑',
  document: '文档',
  dog: '狗',
  cat: '猫',
  food: '食物',
  group: '多人',
  indoor: '室内',
  landscape: '风景',
  map: '地图',
  nature: '自然',
  office: '办公室',
  outdoor: '户外',
  person: '人物',
  phone: '手机',
  printed_page: '印刷页面',
  receipt: '票据',
  screenshot: '截图',
  text: '文字',
  vehicle: '交通工具',
  whiteboard: '白板'
}

export function parseImageSemanticOutput(value: string): LocalImageSemanticLabel[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed?.labels)) return []
    return parsed.labels.flatMap((item: any) => {
      const identifier = String(item?.identifier || '').trim().slice(0, 120)
      const confidence = Number(item?.confidence)
      if (!identifier || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return []
      return [{
        identifier,
        displayName: localizedLabels[identifier.toLowerCase()] || identifier.replace(/_/g, ' '),
        confidence
      }]
    }).sort((a, b) => b.confidence - a.confidence).slice(0, 16)
  } catch {
    return []
  }
}

export function buildImageSemanticText(labels: LocalImageSemanticLabel[]): string {
  const visible = labels.filter(label => label.confidence >= 0.05).slice(0, 8)
  if (!visible.length) return ''
  return `[图片视觉·Apple Vision 本地候选｜未经人工确认] 可能包含：${visible
    .map(label => `${label.displayName}${label.displayName !== label.identifier ? `（${label.identifier}）` : ''} ${Math.round(label.confidence * 100)}%`)
    .join('；')}`
}

class LocalImageSemanticService {
  private cachePath = ''
  private cache: Record<string, { labels: LocalImageSemanticLabel[], modelVersion: string }> = {}
  private loaded = false

  initialize(cachePath: string): void {
    this.cachePath = cachePath
  }

  private executable(): string | null {
    const candidates = [
      join(process.resourcesPath || '', 'resources', 'image-semantic-helper'),
      process.env.WEFLOW_IMAGE_SEMANTIC_HELPER || ''
    ].filter(Boolean)
    return candidates.find(path => existsSync(path)) || null
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8'))
      this.cache = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      this.cache = {}
    }
  }

  private save(): void {
    if (!this.cachePath) return
    mkdirSync(dirname(this.cachePath), { recursive: true, mode: 0o700 })
    writeFileSync(this.cachePath, JSON.stringify(this.cache), { mode: 0o600 })
    try { chmodSync(this.cachePath, 0o600) } catch {}
  }

  getStatus(): { available: boolean, executable: string | null, modelVersion: string } {
    const executable = this.executable()
    return { available: Boolean(executable), executable, modelVersion: MODEL_VERSION }
  }

  async classify(imagePath: string, timeoutMs = 20_000): Promise<LocalImageSemanticResult> {
    this.load()
    const executable = this.executable()
    if (!executable) return { success: false, labels: [], error: '本机 Apple Vision helper 不可用' }
    try {
      const stat = statSync(imagePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > 20 * 1024 * 1024) {
        return { success: false, labels: [], error: '图片不存在或超过 20 MB' }
      }
      const hash = createHash('sha256').update(readFileSync(imagePath)).digest('hex')
      const cached = this.cache[hash]
      if (cached?.modelVersion === MODEL_VERSION && Array.isArray(cached.labels)) {
        return { success: true, labels: cached.labels, cached: true }
      }
      const { stdout } = await execFileAsync(executable, [imagePath], {
        timeout: Math.max(1_000, Math.min(30_000, timeoutMs)),
        maxBuffer: 256 * 1024
      })
      const labels = parseImageSemanticOutput(String(stdout || ''))
      this.cache[hash] = { labels, modelVersion: MODEL_VERSION }
      if (Object.keys(this.cache).length > 5000) {
        this.cache = Object.fromEntries(Object.entries(this.cache).slice(-4000))
      }
      this.save()
      return { success: true, labels, cached: false }
    } catch (error: any) {
      return {
        success: false,
        labels: [],
        error: error?.killed ? '图片视觉识别超时' : String(error?.message || error).slice(0, 300)
      }
    }
  }
}

export const localImageSemanticService = new LocalImageSemanticService()
