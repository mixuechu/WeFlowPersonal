const { spawnSync } = require('child_process')

const cli = require.resolve('electron-builder/out/cli/cli.js')
const env = {
  ...process.env,
  ...(process.platform === 'darwin' && !process.env.CSC_IDENTITY_AUTO_DISCOVERY
    ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    : {})
}
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.signal) {
  console.error(`electron-builder 被信号 ${result.signal} 终止`)
  process.exit(1)
}
process.exit(result.status ?? 1)
