export const ASSISTANT_MODULE_NAVIGATION = [
  { id: 'review-inbox', label: '待审阅' },
  { id: 'memory-growth', label: '成长记录' },
  { id: 'assistant-task-reminders', label: '行动待办' },
  { id: 'project-intelligence', label: '项目' },
  { id: 'memory-search', label: '统一检索' },
  { id: 'memory-qa', label: '证据问答' },
  { id: 'structured-claims', label: '事实' },
  { id: 'event-timeline', label: '时间线' },
  { id: 'message-resources', label: '资源' },
  { id: 'personal-memory-graph', label: '图谱' }
] as const

export type AssistantModuleId = typeof ASSISTANT_MODULE_NAVIGATION[number]['id']

export const assistantModuleLabel = (id: string): string | null =>
  ASSISTANT_MODULE_NAVIGATION.find(item => item.id === id)?.label ?? null
