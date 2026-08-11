import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

const between = (startText: string, endText: string): string => {
  const start = page.indexOf(startText)
  const end = page.indexOf(endText, start + startText.length)
  assert.notEqual(start, -1, `${startText} must exist`)
  assert.notEqual(end, -1, `${endText} must follow ${startText}`)
  return page.slice(start, end)
}

test('all connector mutations share a synchronous lock and visible busy state', () => {
  assert.match(page, /const dataSourceMutationLock = useRef\(false\)/)
  assert.match(page, /const \[documentConnecting, setDocumentConnecting\] = useState\(false\)/)
  assert.match(page, /const documentConnectorGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(
    page,
    /const dataSourceMutationBusy = documentConnecting \|\| calendarConnecting \|\| mailConnecting \|\|[\s\S]*Object\.values\(dataSourceToggling\)\.some\(Boolean\)/
  )

  for (const [start, end] of [
    ['  const toggleDataSource =', '  const configureDocumentSource ='],
    ['  const configureDocumentSource =', '  const configureCalendarSource ='],
    ['  const configureCalendarSource =', '  const saveCalendarSelection ='],
    ['  const saveCalendarSelection =', '  const configureMailSource ='],
    ['  const configureMailSource =', '  const saveMailSelection ='],
    ['  const saveMailSelection =', '  const closeDataSourceModal =']
  ] as const) {
    const operation = between(start, end)
    assert.match(operation, /if \(dataSourceMutationBusy \|\| dataSourceMutationLock\.current\) return/)
    assert.match(operation, /dataSourceMutationLock\.current = true/)
    assert.match(operation, /dataSourceMutationLock\.current = false/)
  }
})

test('document configuration rejects late dialog and commit results', () => {
  const operation = between('  const configureDocumentSource =', '  const configureCalendarSource =')
  assert.match(operation, /documentConnectorGate\.current\.begin\(\)/)
  assert.equal(
    (operation.match(/documentConnectorGate\.current\.isCurrent\(request\)/g) || []).length,
    4,
    'dialog, commit, error, and finally paths must all bind the current request'
  )
})

test('the connector modal cannot change or close configuration during a commit', () => {
  const modal = between('{showDataSources && (', '\n    </div>\n  )')
  assert.match(modal, /button disabled=\{dataSourceMutationBusy\} onClick=\{closeDataSourceModal\}/)
  assert.match(modal, /source\.id === 'documents'[\s\S]*button type="button" disabled=\{dataSourceMutationBusy\}/)
  assert.match(modal, /source\.id === 'calendar'[\s\S]*button type="button" disabled=\{dataSourceMutationBusy\}/)
  assert.match(modal, /source\.id === 'mail'[\s\S]*button type="button" disabled=\{dataSourceMutationBusy\}/)
  assert.match(modal, /disabled=\{dataSourceMutationBusy \|\| !source\.available/)
  assert.equal(
    (modal.match(/disabled=\{dataSourceMutationBusy \|\| ![a-zA-Z]+Picker\.selectedIds\.length\}/g) || []).length,
    2
  )
  assert.match(modal, /assistant-source-footer[\s\S]*disabled=\{dataSourceMutationBusy\} onClick=\{closeDataSourceModal\}/)
})

test('closing the connector modal invalidates every pending response and clears the lock', () => {
  const close = between('  const closeDataSourceModal =', '  const rendererPageIncidentNotice =')
  assert.match(close, /dataSourceToggleGates\.current\.invalidateAll\(\)/)
  assert.match(close, /documentConnectorGate\.current\.invalidate\(\)/)
  assert.match(close, /calendarConnectorGate\.current\.invalidate\(\)/)
  assert.match(close, /mailConnectorGate\.current\.invalidate\(\)/)
  assert.match(close, /dataSourceMutationLock\.current = false/)
})
