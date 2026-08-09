const { randomBytes } = require('node:crypto')
const { existsSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const Database = require('better-sqlite3-multiple-ciphers')
const databasePath = join(tmpdir(), `weflow-workspace-sqlcipher-proof-${process.pid}.sqlite`)
const key = randomBytes(32)

try {
  const database = new Database(databasePath)
  database.pragma('cipher=sqlcipher')
  database.pragma('legacy=4')
  database.key(key)
  database.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('workspace-ok')")
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
}
