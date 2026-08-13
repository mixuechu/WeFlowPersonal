import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('new-task notifications retain a task-specific route through the durable outbox', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const outbox = read('electron/services/notificationOutbox.ts')

  assert.match(service, /buildTaskNotificationTargetRoute\(mineTasks\[0\]\?\.id\)/)
  assert.match(service, /targetRoute: notification\.targetRoute \|\| '\/ai-assistant\?focus=reminders'/)
  assert.match(outbox, /targetRoute\?: string/)
  assert.match(outbox, /normalizeAssistantNotificationTargetRoute\(raw\?\.targetRoute\)/)
  assert.match(outbox, /parsed\.pathname !== '\/ai-assistant'/)
})

test('AI assistant consumes a task notification route as one exact dossier request', () => {
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(page, /focus !== 'reminders' && focus !== 'task'/)
  assert.match(page, /params\.get\('taskId'\)/)
  assert.match(page, /setFocusedTaskId\(taskId\)/)
  assert.match(page, /if \(taskId\) \{[\s\S]*?setSelectedTaskId\(taskId\)/)
  assert.match(page, /setTaskDossierModalOpen\(true\)/)
  assert.match(page, /`assistant-task-\$\{taskId\}`/)
})
