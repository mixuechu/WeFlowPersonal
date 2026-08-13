import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL(
  '../electron/services/aiAssistantService.ts', import.meta.url
), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('entity task dossiers preserve SQLCipher history without granting stale mutations', () => {
  const workspaceStart = service.indexOf('  getGraphWorkspace(')
  const taskPageStart = service.indexOf('  getEntityTaskPage(', workspaceStart)
  const taskPageEnd = service.indexOf('\n  getEntityAuditPage(', taskPageStart)
  assert.ok(workspaceStart > 0 && taskPageStart > workspaceStart && taskPageEnd > taskPageStart)

  const workspace = service.slice(workspaceStart, taskPageStart)
  const taskDirectory = service.slice(taskPageStart, taskPageEnd)
  for (const source of [workspace, taskDirectory]) {
    assert.match(source, /\.items\.map\(task =>/)
    assert.doesNotMatch(source, /\.items\.flatMap\(task =>/)
    assert.match(source, /mutationToken: current \? buildTaskMutationToken\(current\) : undefined/)
    assert.match(source, /sqlcipher_history_read_only/)
  }

  const dossierStart = page.indexOf('<section id="entity-dossier-tasks">')
  const dossierEnd = page.indexOf('\n              </section>', dossierStart)
  const dossier = page.slice(dossierStart, dossierEnd)
  assert.match(dossier, /task\.mutationToken/)
  assert.match(dossier, /SQLCipher 历史记录 · 当前只读/)
})
