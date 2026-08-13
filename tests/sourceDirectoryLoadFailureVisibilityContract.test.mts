import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('conversation source filters clear the previous scope before a debounced authority read', () => {
  assert.match(page, /if \(!showSources\) return[\s\S]*sourceDirectoryGate\.current\.invalidate\(\)[\s\S]*setSourceDirectory\(\{[\s\S]*items: \[\], total: 0[\s\S]*window\.setTimeout\(\(\) => void loadConversationSources\(0, false\), 250\)/)
  assert.match(page, /setSourceDirectoryError\(''\)[\s\S]*if \(!append\) \{[\s\S]*items: \[\], total: 0/)
})

test('conversation source failures do not masquerade as empty results and retain exact continuation retry', () => {
  assert.match(page, /信息来源目录读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有匹配的信息来源”/)
  assert.match(page, /sourceDirectory\.items\.length,[\s\S]*sourceDirectory\.items\.length > 0/)
  assert.match(page, /!sourceLoading && !sourceDirectoryError && !sourceDirectory\.items\.length/)
  assert.match(page, /来源数量未知 · 请重试读取/)
  assert.match(page, /disabled=\{sourceLoading \|\| sourceMutationBusy \|\| Boolean\(sourceDirectoryError\)\}/)
})

test('connector directory failures expose an explicit retry instead of a false enabled count', () => {
  assert.match(page, /const \[dataSourcesError, setDataSourcesError\] = useState\(''\)/)
  assert.match(page, /数据源连接器配置读取失败/)
  assert.match(page, /当前不会把读取故障解释为“0 个连接器已开启”/)
  assert.match(page, /onClick=\{\(\) => setDataSourcesRefreshKey\(value => value \+ 1\)\}/)
  assert.match(page, /连接器数量未知 · 请重试读取/)
  assert.match(page, /setMessage\(`\$\{source\.displayName\}数据源已\$\{updated\.enabled \? '开启' : '暂停'\}。`\)[\s\S]*await load\(\)\.catch\(\(\) => \{\}\)/)
  assert.doesNotMatch(page, /setStatus\(await window\.electronAPI\.aiAssistant\.status\(\)\)/)
})
