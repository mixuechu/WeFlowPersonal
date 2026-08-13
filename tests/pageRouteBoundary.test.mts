import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(
  fileURLToPath(new URL(`../${path}`, import.meta.url)),
  'utf8'
)

test('main lazy routes retain the app shell behind one page recovery boundary', () => {
  const app = read('src/App.tsx')
  const boundaryStart = app.indexOf('<PageRouteBoundary>')
  const routes = app.indexOf('<Routes location={routeLocation}>')
  const boundaryEnd = app.indexOf('</PageRouteBoundary>')

  assert.ok(boundaryStart >= 0)
  assert.ok(boundaryStart < routes)
  assert.ok(routes < boundaryEnd)
  assert.match(app, /<Suspense fallback={<PageLoadingFallback \/>}>/)
  assert.doesNotMatch(
    app.slice(boundaryStart, boundaryEnd),
    /<Suspense fallback={null}>/
  )
})

test('page recovery hides raw errors and offers both retry and safe navigation', () => {
  const boundary = read('src/components/PageRouteBoundary.tsx')

  assert.match(boundary, /role="alert"/)
  assert.match(boundary, /rememberPageRecoveryRoute/)
  assert.match(boundary, /window\.location\.reload\(\)/)
  assert.match(boundary, /重新加载并打开当前页面/)
  assert.match(boundary, /navigate\('\/home', \{ replace: true \}\)/)
  assert.doesNotMatch(boundary, /error\.message|error\.stack/)
})

test('lazy route loading is visible and explains its local-only boundary', () => {
  const boundary = read('src/components/PageRouteBoundary.tsx')

  assert.match(boundary, /role="status"/)
  assert.match(boundary, /正在打开本机页面/)
  assert.match(boundary, /不会发送个人数据/)
})
