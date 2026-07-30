const { execFileSync } = require('child_process')
const { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require('fs')
const { join } = require('path')

const WCDB_FRAMEWORK_ID = '@rpath/WCDB.framework/Versions/2.1.15/WCDB'
const WCDB_DYLIB_ID = '@loader_path/libWCDB.dylib'

function walk(dir, matches = []) {
  if (!existsSync(dir)) return matches

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walk(fullPath, matches)
    } else if (entry === 'libwcdb_api.dylib') {
      matches.push(fullPath)
    }
  }

  return matches
}

function patchWcdbDylib(dylibPath) {
  const linkedLibraries = execFileSync('otool', ['-L', dylibPath], {
    encoding: 'utf8',
  })

  if (!linkedLibraries.includes(WCDB_FRAMEWORK_ID)) {
    return false
  }

  execFileSync('install_name_tool', [
    '-change',
    WCDB_FRAMEWORK_ID,
    WCDB_DYLIB_ID,
    dylibPath,
  ])

  return true
}

function findStableLocalSigningIdentity() {
  if (process.env.WEFLOW_LOCAL_SIGN_IDENTITY) {
    return process.env.WEFLOW_LOCAL_SIGN_IDENTITY.trim()
  }
  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    return output.match(/\)\s+([A-F0-9]{40})\s+"Apple Development:/)?.[1] || ''
  } catch {
    return ''
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  const encryptedSqliteModule = 'better-sqlite3-multiple-ciphers'
  const targetArch = context.arch === 3 || String(context.appOutDir).includes('arm64') ? 'arm64'
    : context.arch === 1 || String(context.appOutDir).includes('x64') ? 'x64'
      : process.arch
  const electronVersion = String(context.packager.config.electronVersion || require('electron/package.json').version)
  const electronRebuild = join(process.cwd(), 'node_modules', '.bin', 'electron-rebuild')
  const encryptedSqliteSource = join(
    process.cwd(), 'node_modules', encryptedSqliteModule, 'build', 'Release', 'better_sqlite3.node'
  )
  const encryptedSqliteTarget = join(
    resourcesDir, 'app.asar.unpacked', 'node_modules', encryptedSqliteModule,
    'build', 'Release', 'better_sqlite3.node'
  )
  execFileSync(electronRebuild, [
    '-v', electronVersion,
    '-a', targetArch,
    '-w', encryptedSqliteModule,
    '-f',
  ], { stdio: 'inherit' })
  if (!existsSync(encryptedSqliteSource)) throw new Error('SQLCipher 原生模块重编译后不存在')
  mkdirSync(join(encryptedSqliteTarget, '..'), { recursive: true })
  copyFileSync(encryptedSqliteSource, encryptedSqliteTarget)
  chmodSync(encryptedSqliteTarget, 0o755)
  console.log(`[afterPack] Rebuilt SQLCipher addon for Electron ${electronVersion}/${targetArch}`)
  const imageSemanticSource = join(process.cwd(), 'electron', 'helpers', 'ImageSemanticHelper.swift')
  const imageSemanticDir = join(resourcesDir, 'resources')
  const imageSemanticExecutable = join(imageSemanticDir, 'image-semantic-helper')
  if (existsSync(imageSemanticSource)) {
    try {
      mkdirSync(imageSemanticDir, { recursive: true })
      execFileSync('xcrun', ['swiftc', '-O', imageSemanticSource, '-o', imageSemanticExecutable], { stdio: 'inherit' })
      chmodSync(imageSemanticExecutable, 0o755)
      console.log(`[afterPack] Compiled local Apple Vision helper at ${imageSemanticExecutable}`)
    } catch (error) {
      console.warn(`[afterPack] Apple Vision helper unavailable: ${error?.message || error}`)
    }
  }
  if (existsSync(imageSemanticExecutable)) {
    const helperIdentity = findStableLocalSigningIdentity()
    execFileSync('codesign', [
      '--force',
      '--timestamp=none',
      '--sign',
      helperIdentity || '-',
      imageSemanticExecutable,
    ], { stdio: 'inherit' })
    console.log(`[afterPack] Signed Apple Vision helper with ${helperIdentity || 'ad-hoc fallback'}`)
  }
  const calendarSource = join(process.cwd(), 'electron', 'helpers', 'CalendarHelper.swift')
  const calendarInfo = join(process.cwd(), 'electron', 'helpers', 'CalendarHelper-Info.plist')
  const calendarExecutable = join(imageSemanticDir, 'calendar-helper')
  if (existsSync(calendarSource) && existsSync(calendarInfo)) {
    try {
      mkdirSync(imageSemanticDir, { recursive: true })
      execFileSync('xcrun', [
        'swiftc', '-O', calendarSource,
        '-Xlinker', '-sectcreate',
        '-Xlinker', '__TEXT',
        '-Xlinker', '__info_plist',
        '-Xlinker', calendarInfo,
        '-o', calendarExecutable,
      ], { stdio: 'inherit' })
      chmodSync(calendarExecutable, 0o755)
      const helperIdentity = findStableLocalSigningIdentity()
      execFileSync('codesign', [
        '--force',
        '--timestamp=none',
        '--sign',
        helperIdentity || '-',
        calendarExecutable,
      ], { stdio: 'inherit' })
      console.log(`[afterPack] Compiled and signed EventKit helper with ${helperIdentity || 'ad-hoc fallback'}`)
    } catch (error) {
      console.warn(`[afterPack] EventKit helper unavailable: ${error?.message || error}`)
    }
  }
  const dylibs = walk(resourcesDir)

  for (const dylibPath of dylibs) {
    const patched = patchWcdbDylib(dylibPath)
    if (patched) {
      console.log(`[afterPack] Rewired WCDB dependency for ${dylibPath}`)
    }
  }

  const frameworkRoots = [
    join(resourcesDir, 'resources', 'welive', 'macos', 'arm64', 'resources', 'macos', 'universal', 'WCDB.framework'),
    join(resourcesDir, 'resources', 'welive', 'macos', 'x64', 'resources', 'macos', 'universal', 'WCDB.framework'),
  ]

  for (const frameworkPath of frameworkRoots) {
    if (existsSync(frameworkPath)) {
      rmSync(frameworkPath, { recursive: true, force: true })
      console.log(`[afterPack] Removed invalid framework bundle ${frameworkPath}`)
    }
  }

  // 本地构建跳过 electron-builder 的在线时间戳签名后，在这里使用固定的
  // Apple Development 身份签名。稳定的 designated requirement 可让钥匙串
  // 记住 Safe Storage 访问许可，避免每次重打包都弹窗；没有本地证书时才
  // 降级为 ad-hoc 签名。
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    const identity = findStableLocalSigningIdentity()
    const signArgs = ['--force', '--deep', '--timestamp=none', '--sign', identity || '-']
    if (identity) signArgs.push('--entitlements', join(process.cwd(), 'electron', 'entitlements.mac.plist'))
    signArgs.push(appPath)
    execFileSync('codesign', signArgs, {
      stdio: 'inherit',
    })
    console.log(`[afterPack] Applied ${identity ? `stable local signature ${identity}` : 'ad-hoc fallback signature'} to ${appPath}`)
  }
}
