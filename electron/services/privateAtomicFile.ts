import crypto from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

const syncDirectory = (path: string): void => {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export function writePrivateFileAtomically(path: string, content: Uint8Array): {
  bytes: number
  sha256: string
} {
  const target = String(path || '')
  const targetName = basename(target)
  if (!target || !targetName || targetName === '.' || targetName === '..' ||
      (existsSync(target) && statSync(target).isDirectory())) {
    throw new Error('未选择有效的导出文件')
  }
  const directory = dirname(target)
  const temporary = join(
    directory,
    `.${targetName}.weflow-${process.pid}-${crypto.randomUUID()}.tmp`
  )
  const payload = Buffer.from(content)
  try {
    const descriptor = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(descriptor, payload)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    try { chmodSync(temporary, 0o600) } catch {}
    const written = readFileSync(temporary)
    if (!written.equals(payload)) throw new Error('迁移包临时文件写入校验失败')
    renameSync(temporary, target)
    syncDirectory(directory)
    try { chmodSync(target, 0o600) } catch {}
    return {
      bytes: payload.length,
      sha256: crypto.createHash('sha256').update(payload).digest('hex')
    }
  } catch (error) {
    try { unlinkSync(temporary) } catch {}
    throw error
  } finally {
    payload.fill(0)
  }
}
