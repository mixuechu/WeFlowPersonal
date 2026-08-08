import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export type RendererNavigationPolicy = {
  distRoot: string
  devServerUrl?: string
}

const normalizedOrigin = (rawUrl: string | undefined): string | null => {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

const isInsideDirectory = (candidate: string, root: string): boolean => {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  const child = relative(resolvedRoot, resolvedCandidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export const isAllowedRendererNavigation = (
  rawUrl: unknown,
  policy: RendererNavigationPolicy
): boolean => {
  const value = String(rawUrl || '').trim()
  if (!value) return false

  try {
    const parsed = new URL(value)
    const devOrigin = normalizedOrigin(policy.devServerUrl)
    if (devOrigin && parsed.origin === devOrigin) return true
    if (parsed.protocol !== 'file:') return false
    return isInsideDirectory(fileURLToPath(parsed), policy.distRoot)
  } catch {
    return false
  }
}
