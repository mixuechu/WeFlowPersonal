const normalizeRemovedEntryCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100_000, Math.trunc(value)))
}

/**
 * PATH entries can contain the local username, package-manager layout and
 * private workspace names. Startup diagnostics only need the aggregate count
 * to prove that the allowlist policy ran; never include the rejected entries.
 */
export const formatPathSanitizationDiagnostic = (removedEntryCount: unknown): string =>
  `使用白名单裁剪 PATH，移除 ${normalizeRemovedEntryCount(removedEntryCount)} 个非受信任目录`
