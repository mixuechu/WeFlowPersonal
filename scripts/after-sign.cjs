const { execFileSync } = require('child_process')
const { join } = require('path')

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identity = String(process.env.WEFLOW_LOCAL_SIGN_IDENTITY || '').trim()
  const signArgs = ['--force', '--deep', '--timestamp=none', '--sign', identity || '-']
  if (identity) signArgs.push('--entitlements', join(process.cwd(), 'electron', 'entitlements.mac.plist'))
  signArgs.push(appPath)
  execFileSync('codesign', signArgs, { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
  console.log(`[afterSign] Applied and verified ${identity ? `explicit release signature ${identity}` : 'password-free ad-hoc signature'} for ${appPath}`)
}
