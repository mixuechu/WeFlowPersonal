import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  emptySensitiveCachePrivacy,
  inspectSensitiveCacheFile,
  loadEncryptedSensitiveCache,
  writeEncryptedSensitiveCache,
  type SensitiveCachePrivacy
} from './encryptedSensitiveCache.ts'

const execFileAsync = promisify(execFile)

class LocalOcrService {
  private cachePath = ''
  private cache: Record<string, string> = {}
  private loaded = false
  private encryptionKey: Buffer | string = ''
  private privacy: SensitiveCachePrivacy = emptySensitiveCachePrivacy()

  initialize(cachePath: string, encryptionKey: Buffer | string): void {
    this.cachePath = cachePath
    this.encryptionKey = encryptionKey
    this.cache = {}
    this.loaded = false
    this.privacy = emptySensitiveCachePrivacy()
    this.load()
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
      const loaded = loadEncryptedSensitiveCache<Record<string, unknown>>(this.cachePath, this.encryptionKey)
      this.cache = Object.fromEntries(Object.entries(loaded.value)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      this.privacy = loaded.privacy
    } catch (error) {
      this.cache = {}
      this.privacy = {
        ...emptySensitiveCachePrivacy(),
        writable: false,
        error: String(error instanceof Error ? error.message : error)
      }
    }
  }

  private save(): void {
    if (!this.cachePath) return
    if (!this.privacy.writable) return
    this.privacy = {
      ...writeEncryptedSensitiveCache(this.cachePath, this.cache, this.encryptionKey),
      migratedPlaintext: this.privacy.migratedPlaintext
    }
  }

  getPrivacyStatus(): any {
    return {
      ...this.privacy,
      ...inspectSensitiveCacheFile(this.cachePath),
      entries: Object.keys(this.cache).length
    }
  }

  async getStatus(): Promise<{ available: boolean; chinese: boolean; executable: string | null; privacy: any }> {
    const executable = this.executable()
    if (!executable) return { available: false, chinese: false, executable: null, privacy: this.getPrivacyStatus() }
    try {
      const { stdout } = await execFileAsync(executable, ['--list-langs'], { timeout: 10_000 })
      return { available: true, chinese: /(^|\s)chi_sim(\s|$)/m.test(stdout), executable, privacy: this.getPrivacyStatus() }
    } catch {
      return { available: false, chinese: false, executable, privacy: this.getPrivacyStatus() }
    }
  }

  async recognize(
    imagePath: string,
    options: { timeoutMs?: number; maxChars?: number; psm?: number } = {}
  ): Promise<{ success: boolean; text?: string; cached?: boolean; error?: string }> {
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
        imagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', String(options.psm || 6)
      ], { timeout: Math.max(1_000, Math.min(45_000, Number(options.timeoutMs || 45_000))), maxBuffer: 2 * 1024 * 1024 })
      const text = String(stdout || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
        .slice(0, Math.max(100, Math.min(10_000, Number(options.maxChars || 4_000))))
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
