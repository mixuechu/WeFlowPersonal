import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Check, Clock3, RefreshCw, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import './AiAssistantPage.scss'

type Task = {
  id: string
  title: string
  detail?: string
  due?: string
  source?: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
  status: 'todo' | 'doing' | 'done'
}

function AiAssistantPage() {
  const [status, setStatus] = useState<any>(null)
  const [dashboard, setDashboard] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const [nextStatus, nextDashboard] = await Promise.all([
      window.electronAPI.aiAssistant.status(),
      window.electronAPI.aiAssistant.dashboard()
    ])
    setStatus(nextStatus)
    setDashboard(nextDashboard)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const briefing = dashboard?.briefing
  const tasks: Task[] = dashboard?.tasks || []
  const openTasks = useMemo(() => tasks.filter(task => task.status !== 'done'), [tasks])

  const syncNow = async () => {
    setSyncing(true)
    setMessage('')
    try {
      const result = await window.electronAPI.aiAssistant.sync()
      setMessage(`补齐完成：${result.newMessageCount} 条新消息，${result.newTaskCount} 个新待办`)
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setSyncing(false)
    }
  }

  const openSettings = async () => {
    setSettings(await window.electronAPI.aiAssistant.getSettings())
    setShowSettings(true)
  }

  const saveSettings = async () => {
    await window.electronAPI.aiAssistant.setSettings(settings)
    setShowSettings(false)
    await load()
  }

  const toggleTask = async (task: Task) => {
    await window.electronAPI.aiAssistant.updateTask(task.id, {
      status: task.status === 'done' ? 'todo' : 'done'
    })
    await load()
  }

  return (
    <div className="ai-assistant-page native">
      <div className="ai-assistant-toolbar">
        <div className="ai-assistant-title">
          <span className="ai-assistant-title-icon"><Bot size={18} /></span>
          <div><strong>AI 行动助理</strong><span>从聊天中持续发现重要信息与待办</span></div>
        </div>
        <div className="ai-assistant-service-meta">
          <span className={`service-dot ${status?.cursor?.lastError ? '' : 'online'}`} />
          <span>{syncing || status?.syncing ? '正在补齐消息' : status?.cursor?.lastError ? '等待自动重试' : '增量服务正常'}</span>
          <span className="service-divider" />
          <ShieldCheck size={13} /><span>Key 已加密存储</span>
          <button type="button" onClick={openSettings} aria-label="AI 助理设置"><Settings2 size={14} /></button>
        </div>
      </div>

      <div className="ai-assistant-content">
        <header className="assistant-hero-header">
          <div>
            <p className="assistant-kicker">INCREMENTAL INTELLIGENCE</p>
            <h1>把聊天，变成下一步行动。</h1>
            <p className="assistant-subtitle">
              {status?.cursor?.lastMessageTimestamp
                ? `已持续处理至 ${new Date(status.cursor.lastMessageTimestamp * 1000).toLocaleString('zh-CN')}`
                : '首次运行将读取最近三天，此后按时间戳持续补齐。'}
            </p>
          </div>
          <button className="assistant-sync-button" onClick={syncNow} disabled={syncing || status?.syncing || !status?.configured}>
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
            {syncing ? '正在理解消息…' : '立即补齐'}
          </button>
        </header>

        {!status?.configured && (
          <section className="assistant-setup-banner">
            <Sparkles size={18} />
            <div><strong>还差最后一步</strong><span>设置 DeepSeek API Key 后，AI 助理即可开始工作。</span></div>
            <button onClick={openSettings}>现在设置</button>
          </section>
        )}

        {message && <div className={`assistant-message ${message.includes('完成') ? 'success' : ''}`}>{message}</div>}

        <section className="assistant-briefing-card">
          <div className="assistant-briefing-copy">
            <span className="assistant-eyebrow">最新增量简报</span>
            <h2>{briefing?.headline || '等待第一次增量整理'}</h2>
            <p>{briefing?.summary || '服务会在启动时自动补齐，也会在每天设定时间整理新增消息。'}</p>
          </div>
          <div className="assistant-stat">
            <strong>{briefing?.messageCount || 0}</strong>
            <span>条本次新增消息</span>
            <small>{status?.scheduleTime || '20:00'} 自动整理</small>
          </div>
        </section>

        <div className="assistant-grid">
          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">ACTION ITEMS</span><h3>持续待办池</h3></div>
              <span className="assistant-count">{openTasks.length} 项未完成</span>
            </div>
            <div className="assistant-task-list">
              {tasks.length === 0 && <div className="assistant-empty">暂时没有识别到明确待办</div>}
              {tasks.map(task => (
                <article className={`assistant-task ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                  <button className="assistant-check" onClick={() => void toggleTask(task)} aria-label={task.status === 'done' ? '恢复待办' : '完成待办'}>
                    {task.status === 'done' && <Check size={13} />}
                  </button>
                  <div>
                    <strong>{task.title}</strong>
                    {task.detail && <p>{task.detail}</p>}
                    <div className="assistant-tags">
                      {task.source && <span>来自 {task.source}</span>}
                      {task.due && <span><Clock3 size={10} /> {task.due}</span>}
                      <span>{Math.round(task.confidence * 100)}% 可信</span>
                    </div>
                  </div>
                  <i className={`priority ${task.priority}`} />
                </article>
              ))}
            </div>
          </section>

          <aside className="assistant-panel assistant-signals">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">SIGNALS</span><h3>值得留意</h3></div></div>
            {(briefing?.highlights || []).map((highlight: string, index: number) => (
              <div className="assistant-highlight" key={`${index}-${highlight}`}><Sparkles size={13} /><span>{highlight}</span></div>
            ))}
            {!(briefing?.highlights?.length) && <div className="assistant-empty">暂无重要动态</div>}
            {status?.cursor?.lastError && <div className="assistant-error"><strong>上次同步未完成</strong><span>{status.cursor.lastError}</span></div>}
          </aside>
        </div>
      </div>

      {showSettings && settings && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal">
            <div className="assistant-modal-title"><div><h2>AI 助理设置</h2><p>敏感 Key 由 Electron safeStorage 加密保存。</p></div><button onClick={() => setShowSettings(false)}><X size={16} /></button></div>
            <label><span>DeepSeek API Key</span><input type="password" placeholder={settings.configured ? '已安全保存；留空表示不修改' : 'sk-...'} onChange={event => setSettings({ ...settings, apiKey: event.target.value })} /></label>
            <label><span>API 地址</span><input value={settings.baseUrl} onChange={event => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
            <label><span>模型</span><input value={settings.model} onChange={event => setSettings({ ...settings, model: event.target.value })} /></label>
            <label><span>每日整理时间</span><input type="time" value={settings.scheduleTime} onChange={event => setSettings({ ...settings, scheduleTime: event.target.value })} /></label>
            <label className="assistant-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /><span>启用启动补齐与每日自动整理</span></label>
            <div className="assistant-modal-actions"><button onClick={() => setShowSettings(false)}>取消</button><button className="primary" onClick={saveSettings}>保存设置</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiAssistantPage
