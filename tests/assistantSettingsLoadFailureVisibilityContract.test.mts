import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('assistant settings open before loading and expose a retryable authority read', () => {
  assert.match(page, /const settingsLoadGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(page, /const openSettings = \(\) => \{[\s\S]*setShowSettings\(true\)[\s\S]*void loadSettingsForDialog\(\)/)
  assert.match(page, /setSettings\(null\)[\s\S]*await window\.electronAPI\.aiAssistant\.getSettings\(\)/)
  assert.match(page, /正在读取当前设置/)
  assert.match(page, /AI 助理设置读取失败/)
  assert.match(page, /当前不会用空值或旧值冒充已保存设置/)
  assert.match(page, /onClick=\{\(\) => void loadSettingsForDialog\(\)\}/)
})

test('settings save success remains authoritative when follow-up views fail to refresh', () => {
  assert.match(page, /const result = await window\.electronAPI\.aiAssistant\.setSettings\(settings\)[\s\S]*setShowSettings\(false\)[\s\S]*setMessage\(result\?\.maintenanceWarning \|\| 'AI 助理设置已完整保存'\)[\s\S]*Promise\.all\(\[[\s\S]*load\(\)\.catch\(\(\) => \{\}\)[\s\S]*refreshMemoryDiagnostics\(\)\.catch\(\(\) => \{\}\)/)
  assert.doesNotMatch(page, /setShowSettings\(false\)\s*\n\s*await load\(\)/)
})

test('a stale settings conflict contains a second read failure inside the dialog', () => {
  assert.match(page, /AI 助理设置在展示后发生了变化[\s\S]*try \{[\s\S]*getSettings\(\)[\s\S]*catch \(refreshError/)
  assert.match(page, /设置已发生变化，但重新读取当前值失败/)
  assert.match(page, /settingsLoadGate\.current\.invalidate\(\)[\s\S]*setShowSettings\(false\)/)
})
