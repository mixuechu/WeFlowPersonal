import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { extractAttachmentText } from './attachmentTextExtractor.ts'
import type {
  PersonalDataSourceConnector,
  PersonalDataSourceItem,
  PersonalDataSourcePullResult
} from './personalDataSources.ts'

const SUPPORTED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml',
  '.html', '.htm', '.log', '.yaml', '.yml', '.ini', '.conf',
  '.docx', '.pptx', '.xlsx', '.pdf'
])
const MAX_SCAN_FILES = 20_000
const MAX_SCAN_DEPTH = 12

type DocumentCheckpoint = {
  version: 1
  root: string
  files: Record<string, { mtimeMs: number; size: number; status: string }>
}

function parseCheckpoint(value: string, root: string): DocumentCheckpoint {
  try {
    const parsed = JSON.parse(value || '{}')
    if (parsed?.version === 1 && parsed.root === root && parsed.files && typeof parsed.files === 'object') {
      const entries = Object.entries(parsed.files).slice(0, MAX_SCAN_FILES)
      return { version: 1, root, files: Object.fromEntries(entries) as DocumentCheckpoint['files'] }
    }
  } catch {}
  return { version: 1, root, files: {} }
}

function collectFiles(root: string): Array<{ path: string; relativePath: string; mtimeMs: number; size: number }> {
  const files: Array<{ path: string; relativePath: string; mtimeMs: number; size: number }> = []
  const visit = (directory: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SCAN_FILES) return
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES || entry.name.startsWith('.')) continue
      const path = resolve(directory, entry.name)
      let stats
      try {
        stats = lstatSync(path)
      } catch {
        continue
      }
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        visit(path, depth + 1)
        continue
      }
      if (!stats.isFile() || !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      const relativePath = relative(root, path)
      if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..') continue
      files.push({ path, relativePath, mtimeMs: stats.mtimeMs, size: stats.size })
    }
  }
  visit(root, 0)
  return files.sort((left, right) =>
    left.mtimeMs - right.mtimeMs || left.relativePath.localeCompare(right.relativePath))
}

export class LocalDocumentDataSource implements PersonalDataSourceConnector {
  readonly id = 'documents'
  readonly kind = 'document' as const
  readonly displayName = '本机文档目录'
  readonly description = '本机文件夹中的文本、Office 和 PDF 文档'
  readonly available = true
  readonly localOnly = true
  readonly capabilities = ['incremental', 'original-evidence', 'claims', 'events', 'attachments'] as const
  readonly root: string

  constructor(folderPath: string) {
    const root = realpathSync(resolve(String(folderPath || '')))
    if (!statSync(root).isDirectory()) throw new Error('本机文档数据源必须指向文件夹')
    this.root = root
  }

  async pull(input: { checkpoint: string; limit: number; signal?: AbortSignal }): Promise<PersonalDataSourcePullResult> {
    const checkpoint = parseCheckpoint(input.checkpoint, this.root)
    const candidates = collectFiles(this.root).filter(file => {
      const previous = checkpoint.files[file.relativePath]
      return !previous || previous.mtimeMs !== file.mtimeMs || previous.size !== file.size
    })
    const selected = candidates.slice(0, Math.max(1, Math.min(100, input.limit)))
    const items: PersonalDataSourceItem[] = []
    const warnings: string[] = []
    for (const file of selected) {
      if (input.signal?.aborted) throw new Error('本机文档扫描已取消')
      const extracted = await extractAttachmentText(file.path, file.size)
      const retryable = extracted.status === 'failed' || extracted.status === 'dependency_missing'
      if (retryable) warnings.push(`${basename(file.path)}：${extracted.status}`)
      if (!retryable) {
        checkpoint.files[file.relativePath] = {
          mtimeMs: file.mtimeMs,
          size: file.size,
          status: extracted.status
        }
      }
      if (!extracted.success && extracted.status !== 'ocr_required') continue
      const externalId = createHash('sha256')
        .update(`${this.root}\0${file.relativePath}`)
        .digest('hex')
        .slice(0, 32)
      const content = extracted.success ? extracted.text : '[扫描版 PDF，等待本地 OCR]'
      items.push({
        sourceId: this.id,
        externalId,
        kind: 'document',
        occurredAt: new Date(file.mtimeMs).toISOString(),
        title: basename(file.path),
        content,
        scopeId: this.root,
        scopeName: basename(this.root),
        metadata: {
          relativePath: file.relativePath,
          localPath: file.path,
          extension: extname(file.path).toLowerCase(),
          size: file.size,
          mtimeMs: file.mtimeMs,
          extractionStatus: extracted.status,
          extractionFormat: extracted.format,
          structure: extracted.structure || null,
          contentHash: createHash('sha256').update(content).digest('hex')
        }
      })
    }
    return {
      items,
      nextCheckpoint: JSON.stringify(checkpoint),
      hasMore: candidates.length > selected.length,
      warnings
    }
  }
}

export const LOCAL_DOCUMENT_SOURCE_LIMITS = {
  maxScanFiles: MAX_SCAN_FILES,
  maxScanDepth: MAX_SCAN_DEPTH,
  supportedExtensions: [...SUPPORTED_EXTENSIONS]
}
