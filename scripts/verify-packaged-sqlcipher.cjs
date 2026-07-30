const { app } = require('electron')
const { randomBytes } = require('node:crypto')
const { existsSync, unlinkSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

app.whenReady().then(() => {
  const addonArgument = process.argv[2]
  if (!addonArgument) throw new Error('Usage: electron verify-packaged-sqlcipher.cjs <module-directory>')
  const addonPath = resolve(addonArgument)
  const Database = require(addonPath)
  const databasePath = join(tmpdir(), `weflow-packaged-sqlcipher-proof-${process.pid}.sqlite`)
  const key = randomBytes(32)
  try {
    const database = new Database(databasePath)
    database.pragma('cipher=sqlcipher')
    database.pragma('legacy=4')
    database.key(key)
    database.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('packaged-ok')")
    const result = {
      modules: process.versions.modules,
      cipher: database.pragma('cipher', { simple: true }),
      integrity: database.pragma('integrity_check', { simple: true }),
      value: database.prepare('SELECT value FROM proof').pluck().get()
    }
    database.close()
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    key.fill(0)
    if (existsSync(databasePath)) unlinkSync(databasePath)
    app.quit()
  }
}).catch(error => {
  process.stderr.write(`${error?.stack || error}\n`)
  app.exit(1)
})
