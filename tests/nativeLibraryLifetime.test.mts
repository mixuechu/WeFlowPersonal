import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DARWIN_PROCESS_LIFETIME_DLOPEN_FLAGS,
  pinNativeLibraryForProcessLifetime
} from '../electron/services/nativeLibraryLifetime.ts'

test('macOS native library pin uses RTLD_NOW and RTLD_NODELETE without unloading', () => {
  const calls: any[] = []
  const runtime = {
    func(signature: string) {
      calls.push(['func', signature])
      if (signature.startsWith('void* dlopen')) {
        return (path: string, flags: number) => {
          calls.push(['dlopen', path, flags])
          return { address: 1 }
        }
      }
      throw new Error(`unexpected signature: ${signature}`)
    }
  }
  const koffi = {
    load(path: string | null) {
      calls.push(['load', path])
      return runtime
    }
  }
  const pin = pinNativeLibraryForProcessLifetime(koffi, '/tmp/libwcdb_api.dylib', 'darwin')
  assert.equal(DARWIN_PROCESS_LIFETIME_DLOPEN_FLAGS, 0x82)
  assert.equal(pin?.runtime, runtime)
  assert.deepEqual(calls, [
    ['load', null],
    ['func', 'void* dlopen(const char* path, int mode)'],
    ['dlopen', '/tmp/libwcdb_api.dylib', 0x82]
  ])
})

test('native library pin is a no-op off macOS and reports dyld failures', () => {
  assert.equal(pinNativeLibraryForProcessLifetime({}, '/tmp/library.so', 'linux'), null)
  const runtime = {
    func(signature: string) {
      if (signature.startsWith('void* dlopen')) return () => null
      return () => 'signature rejected'
    }
  }
  assert.throws(
    () => pinNativeLibraryForProcessLifetime({ load: () => runtime }, '/tmp/missing.dylib', 'darwin'),
    /signature rejected/
  )
})
