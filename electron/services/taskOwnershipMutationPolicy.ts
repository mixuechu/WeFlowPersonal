export function assertTaskOwnershipMutationRevision(
  expectedRevision: unknown,
  currentRevision: unknown
): void {
  const expected = String(expectedRevision || '').trim()
  const current = String(currentRevision || '').trim()
  if (!expected || !current || expected !== current) {
    throw new Error('待办归属记录在展示后发生了变化，请刷新后重新确认')
  }
}
