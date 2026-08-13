export function assertStructuredMemoryMutationRevision(
  expectedRevision: unknown,
  currentRevision: unknown
): void {
  const expected = String(expectedRevision || '').trim()
  const current = String(currentRevision || '').trim()
  if (!expected || !current || expected !== current) {
    throw new Error('事实与事件档案在展示后发生了变化，请刷新后重新操作')
  }
}
