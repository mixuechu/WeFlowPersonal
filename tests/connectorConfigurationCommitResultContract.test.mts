import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')

test('calendar and mail configuration IPC return the committed renderer projection', () => {
  assert.match(service, /sourceId === 'calendar'[\s\S]*return presentDataSourceForRenderer\(personalMemoryStore\.configureDataSource\(/)
  assert.match(service, /sourceId === 'mail'[\s\S]*return presentDataSourceForRenderer\(personalMemoryStore\.configureDataSource\('mail'/)
})

test('the connector service rejects an uninitialized catalog instead of returning a false empty list', () => {
  assert.match(service, /const internalSources = personalMemoryStore\.listDataSources\(\)/)
  assert.match(service, /PERSONAL_DATA_SOURCE_CATALOG[\s\S]*filter\(id => !registeredIds\.has\(id\)\)/)
  assert.match(service, /if \(missingCatalogIds\.length\) \{[\s\S]*连接器目录尚未初始化完成，请稍后重试/)
  assert.match(service, /return internalSources\.map\(internalSource =>/)
})

test('calendar and mail saves render the commit result without a fallible directory reread', () => {
  assert.match(page, /const updated = await window\.electronAPI\.aiAssistant\.configureDataSource\('calendar'[\s\S]*\.\.\.updated,[\s\S]*selectedCalendarCount: selection\.selectedIds\.length/)
  assert.match(page, /const updated = await window\.electronAPI\.aiAssistant\.configureDataSource\('mail'[\s\S]*\.\.\.updated,[\s\S]*selectedMailboxCount: selection\.selectedIds\.length/)
  assert.equal(
    (page.match(/window\.electronAPI\.aiAssistant\.getDataSources\(\)/g) || []).length,
    1,
    'only the explicit connector-directory loader may read the complete directory'
  )
})

test('all connector version conflicts enter the visible directory reload path', () => {
  assert.match(page, /const refreshDataSourcesAfterConflict = \(\) => \{[\s\S]*dataSourceDirectoryGate\.current\.invalidate\(\)[\s\S]*setDataSources\(\[\]\)[\s\S]*setDataSourcesLoading\(true\)[\s\S]*setDataSourcesRefreshKey\(value => value \+ 1\)/)
  assert.equal((page.match(/refreshDataSourcesAfterConflict\(\)/g) || []).length, 4)
  assert.doesNotMatch(page, /setDataSources\(await window\.electronAPI\.aiAssistant\.getDataSources\(\)\)/)
})
