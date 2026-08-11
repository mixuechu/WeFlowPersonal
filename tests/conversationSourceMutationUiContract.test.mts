import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

const between = (startText: string, endText: string): string => {
  const start = pageSource.indexOf(startText)
  const end = pageSource.indexOf(endText, start + startText.length)
  assert.notEqual(start, -1, `${startText} must exist`)
  assert.notEqual(end, -1, `${endText} must follow ${startText}`)
  return pageSource.slice(start, end)
}

test('conversation source mutations are mutually exclusive and reject late responses', () => {
  assert.match(pageSource, /const sourceMutationGates = useRef\(new KeyedLatestRequestGates\(\)\)/)
  assert.match(pageSource, /const sourceBulkMutationGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(pageSource, /const sourceMutationBusy = sourceBulkMutating \|\| Object\.values\(sourceMutating\)\.some\(Boolean\)/)

  const single = between('  const toggleSource =', '  const setSourceType =')
  assert.match(single, /if \(sourceMutationBusy\) return/)
  assert.match(single, /sourceMutationGates\.current\.begin\(source\.sessionId\)/)
  assert.match(single, /sourceMutationGates\.current\.isCurrent\(source\.sessionId, request\)/)
  assert.match(single, /setSourceMutating\(current => setKeyedLoadingState/)
  assert.match(single, /已\$\{result\.enabled \? '参与' : '停止'\}后续分析/)

  const bulk = between('  const setSourceType =', '  const refreshDataSourcesAfterConflict =')
  assert.match(bulk, /if \(sourceMutationBusy\) return/)
  assert.match(bulk, /sourceBulkMutationGate\.current\.begin\(\)/)
  assert.match(bulk, /sourceBulkMutationGate\.current\.isCurrent\(request\)/)
  assert.match(bulk, /setSourceBulkMutating\(false\)/)
})

test('the source directory cannot change scope or close during a policy commit', () => {
  const modal = between('{showSources && (', '{showDataSources && (')
  assert.match(modal, /disabled=\{sourceMutationBusy\}[\s\S]*setShowSources\(false\)/)
  assert.match(modal, /assistant-source-search[\s\S]*disabled=\{sourceMutationBusy\}/)
  assert.equal((modal.match(/disabled=\{sourceLoading \|\| sourceMutationBusy\}/g) || []).length, 3)
  assert.equal((modal.match(/sourceLoading \|\| sourceMutationBusy \|\| Boolean\(sourceDirectoryError\)/g) || []).length, 3)
})
