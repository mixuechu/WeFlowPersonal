import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('project directory distinguishes loading, authoritative empty and failure states', () => {
  assert.match(page, /setProjectDirectory\(\(current: any\) => \(\{[\s\S]*items: \[\], loading: true, error: undefined/)
  assert.match(page, /项目目录读取失败/)
  assert.match(page, /当前不会把读取失败解释为“没有项目”/)
  assert.match(page, /!projectDirectory\.loading && !projectDirectory\.error/)
  assert.match(page, /projectDirectory\.error && !projectInsights\.length[\s\S]*'读取失败'/)
})

test('project continuation failures retain a revision-bound prefix and ignore stale responses', () => {
  assert.match(page, /const loadMoreProjects = async \(\) => \{[\s\S]*projectDirectoryGate\.current\.begin\(\)/)
  assert.match(page, /if \(!projectDirectoryGate\.current\.isCurrent\(request\)\) return/)
  assert.match(page, /setProjectDirectory\(\(current: any\) => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*个项目仍可查看，但当前目录尚未读完/)
  assert.match(page, /if \(projectInsights\.length\) void loadMoreProjects\(\)/)
  assert.match(page, /projectDirectory\.hasMore && !projectDirectory\.error/)
})
