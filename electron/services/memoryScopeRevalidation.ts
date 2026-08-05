export async function runWithMemoryScopeRevalidation<T>(
  verify: (boundary: 'before' | 'after') => void | Promise<void>,
  work: () => Promise<T>
): Promise<T> {
  await verify('before')
  const result = await work()
  await verify('after')
  return result
}
