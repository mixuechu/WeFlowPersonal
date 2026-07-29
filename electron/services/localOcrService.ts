import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const execFileAsync = promisify(execFile)

class LocalOcrService {
  private cachePath = ''
  private cache: Record<string, string> = {}
  private loaded = false

  initialize(cachePath: string): void {
    this.cachePath = cachePath
  }

  private executable(): string | null {
    for (const path of ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract']) {
      if (existsSync(path)) return path
    }
    return null
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
    writeFileSync(this.cachePath, JSON.stringify(this.cache), { mode: 0o600 })
    try { chmodSync(this.cachePath, 0o600) } catch {}
  }

  async getStatus(): Promise<{ available: boolean; chinese: boolean; executable: string | null }> {
    const executable = this.executable()
    if (!executable) return { available: false, chinese: false, executable: null }
    try {
      const { stdout } = await execFileAsync(executable, ['--list-langs'], { timeout: 10_000 })
      return { available: true, chinese: /(^|\s)chi_sim(\s|$)/m.test(stdout), executable }
    } catch {
      return { available: false, chinese: false, executable }
    }
  }

  async recognize(imagePath: string): Promise<{ success: boolean; text?: string; cached?: boolean; error?: string }> {
    this.load()
    const executable = this.executable()
    if (!executable) return { success: false, error: '本机未安装 Tesseract' }
    try {
      const stat = statSync(imagePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > 20 * 1024 * 1024) {
        return { success: false, error: '图片不存在或超过 20 MB' }
      }
      const bytes = readFileSync(imagePath)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (Object.hasOwn(this.cache, hash)) return { success: true, text: this.cache[hash], cached: true }
      const { stdout } = await execFileAsync(executable, [
        imagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'
      ], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })
      const text = String(stdout || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 4000)
      this.cache[hash] = text
      if (Object.keys(this.cache).length > 5000) {
        this.cache = Object.fromEntries(Object.entries(this.cache).slice(-4000))
      }
      this.save()
      return { success: true, text, cached: false }
    } catch (error: any) {
      return { success: false, error: error?.killed ? 'OCR 超时' : String(error?.message || error).slice(0, 300) }
    }
  }
}

export const localOcrService = new LocalOcrService()
