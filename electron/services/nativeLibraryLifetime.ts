export const DARWIN_PROCESS_LIFETIME_DLOPEN_FLAGS = 0x82

export type NativeLibraryPin = {
  runtime: any
  handle: any
}

/**
 * Acquire a deliberate process-lifetime reference for a macOS dynamic library.
 * The returned objects must stay reachable for the lifetime of the caller.
 */
export function pinNativeLibraryForProcessLifetime(
  koffi: any,
  libraryPath: string,
  platform: NodeJS.Platform = process.platform
): NativeLibraryPin | null {
  if (platform !== 'darwin') return null
  const runtime = koffi.load(null)
  const dlopen = runtime.func('void* dlopen(const char* path, int mode)')
  const handle = dlopen(libraryPath, DARWIN_PROCESS_LIFETIME_DLOPEN_FLAGS)
  if (!handle) {
    const dlerror = runtime.func('const char* dlerror()')
    throw new Error(`无法固定动态库：${String(dlerror() || 'unknown dyld error')}`)
  }
  return { runtime, handle }
}
