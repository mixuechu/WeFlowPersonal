import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

for (const archive of [
  ['claim_archive', '事实档案连续三次读取均发生变化'],
  ['event_timeline', '事件时间线连续三次读取均发生变化'],
  ['task_archive', '历史任务档案连续三次读取均发生变化'],
  ['assistant_archive', '问答会话档案连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} stops automatic stale reloads and exposes manual recovery`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

for (const archive of [
  ['merge_history_archive', '身份合并历史连续三次读取均发生变化'],
  ['entity_evidence_archive', '人物原文档案连续三次读取均发生变化'],
  ['project_evidence_archive', '项目原文档案连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} has bounded dossier recovery`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

test('stale identity anchor directory exits loading with an actionable error', () => {
  assert.match(page, /if \(page\.stale\) \{[\s\S]*setEntityIdentityAnchorPage\([\s\S]*status: 'error',[\s\S]*身份目录在读取期间发生了变化/)
  assert.match(page, /entityIdentityAnchorPage\.status === 'error'[\s\S]*setEntityIdentityAnchorRefreshKey/)
})

for (const archive of [
  ['graph_workspace', '图谱视口连续三次读取均发生变化'],
  ['entity_claim_page', '人物事实档案连续三次读取均发生变化'],
  ['entity_relation_page', '人物关系档案连续三次读取均发生变化'],
  ['entity_event_page', '人物事件档案连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} has bounded graph recovery`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

test('project memory accepts claims, relations and events only as one stable composite', () => {
  assert.match(page, /if \(claims\.stale \|\| relations\.stale \|\| events\.stale\) \{/)
  assert.match(page, /boundedStaleReloads\.current\.next\(\s*'project_memory_composite'/)
  assert.match(page, /项目事实、关系和事件连续三次未能取得同一轮稳定快照/)
  assert.match(page, /boundedStaleReloads\.current\.clear\('project_memory_composite'\)/)

  const compositeStart = page.indexOf(']).then(([claims, relations, events]) => {')
  const compositeEnd = page.indexOf('}).catch(error => {', compositeStart)
  const composite = page.slice(compositeStart, compositeEnd)
  assert.ok(composite.indexOf('if (claims.stale || relations.stale || events.stale)') >= 0)
  assert.ok(
    composite.indexOf('if (claims.stale || relations.stale || events.stale)') <
      composite.indexOf("setProjectMemoryPages({ claims, relations, events, status: 'ready' })")
  )
})

test('project composite errors are not rendered as empty memory', () => {
  assert.match(page, /projectMemoryPages\.status === 'ready' && !projectDossierClaims\.length/)
  assert.match(page, /projectMemoryPages\.status === 'ready' &&[\s\S]*!\(projectMemoryPages\.relations\?\.items \|\| \[\]\)\.length/)
  assert.match(page, /projectMemoryPages\.status === 'ready' && !projectDossierEvents\.length/)
})

test('graph viewport failure is honest and manually retryable', () => {
  assert.match(page, /graphWorkspace\.status === 'error'[\s\S]*图谱视口读取失败/)
  assert.match(page, /当前不会把失败解释为图谱为空/)
  assert.match(page, /setGraphWorkspaceRefreshKey\(value => value \+ 1\)/)
})

for (const archive of [
  ['memory_search', '统一检索连续三次未能取得一致快照'],
  ['graph_review_page', '图谱审阅队列连续三次读取均发生变化'],
  ['model_request_audits', '模型发送审计连续三次读取均发生变化'],
  ['assistant_answer_reviews', '历史回答核验队列连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} has a bounded revision-recovery budget`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

test('unified search stale scope includes the complete effective search request', () => {
  assert.match(page, /'memory_search', JSON\.stringify\(\{ query, mode: memorySearchMode, \.\.\.memorySearchOptions \}\)/)
})

test('graph review stale scope binds every effective directory filter', () => {
  assert.match(page, /'graph_review_page', JSON\.stringify\(\{[\s\S]*status: reviewStatusFilter,[\s\S]*kind: reviewKindFilter,[\s\S]*query: reviewQuery\.trim\(\),[\s\S]*reviewId: focusedReviewId,[\s\S]*entityId: focusedReviewEntityId,[\s\S]*calibrationOutcome: reviewCalibrationOutcomeFilter,[\s\S]*reasonCode: reviewReasonFilter/)
})

for (const archive of [
  ['memory_feedback_archive', '检索反馈档案连续三次读取均发生变化'],
  ['memory_deletion_archive', '删除审计连续三次读取均发生变化'],
  ['memory_maintenance_archive', '维护审计连续三次读取均发生变化'],
  ['memory_growth_archive', '记忆成长档案连续三次读取均发生变化'],
  ['ingestion_archive', '增量运行档案连续三次读取均发生变化'],
  ['cross_store_recovery_archive', '跨存储恢复档案连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} shares bounded stale recovery`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

test('search feedback archive exposes an honest manual retry after bounded recovery', () => {
  assert.match(page, /memoryFeedbackArchive\.status === 'error'[\s\S]*检索反馈档案读取失败/)
  assert.match(page, /当前不会把读取失败解释为没有检索反馈/)
  assert.match(page, /setMemoryFeedbackArchiveRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /memoryFeedbackArchive\.status === 'ready' && memoryFeedbackArchive\.hasMore/)
})

for (const archive of [
  ['resource_archive', '资源档案连续三次读取均发生变化'],
  ['resource_trash_archive', '资源回收站连续三次读取均发生变化'],
  ['project_directory', '项目目录连续三次读取均发生变化'],
  ['task_workset', '行动待办目录连续三次读取均发生变化'],
  ['task_ownership_reviews', '待办归属审阅连续三次读取均发生变化'],
  ['task_feedback_archive', '待办归属反馈档案连续三次读取均发生变化']
] as const) {
  test(`${archive[0]} uses bounded stale recovery`, () => {
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.next\\(\\s*'${archive[0]}'`))
    assert.match(page, new RegExp(archive[1]))
    assert.match(page, new RegExp(`boundedStaleReloads\\.current\\.clear\\('${archive[0]}'\\)`))
  })
}

test('complete monthly task calendar has bounded whole-range recovery', () => {
  assert.match(page, /boundedStaleReloads\.current\.next\([\s\S]*?'task_calendar', JSON\.stringify\(taskCalendarOptions\)/)
  assert.match(page, /本月任务连续三次未能取得完整一致快照/)
  assert.match(page, /boundedStaleReloads\.current\.clear\('task_calendar'\)/)
  assert.match(page, /本月任务读取失败[\s\S]*重试本月任务/)
})
