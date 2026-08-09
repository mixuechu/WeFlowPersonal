import { type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import { rememberPageRecoveryRoute } from '../utils/pageRecoveryRoute'
import './PageRouteBoundary.scss'

export function PageLoadingFallback() {
  return (
    <div className="page-route-loading" role="status" aria-live="polite">
      <span aria-hidden="true" />
      <strong>正在打开本机页面…</strong>
      <small>正在加载界面代码，不会发送个人数据。</small>
    </div>
  )
}

export function PageRouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const boundaryKey = [location.pathname, location.search, location.hash].join('|')

  const fallback = (
    <section className="page-route-failure" role="alert" aria-live="assertive">
      <span className="page-route-failure-icon"><ShieldAlert size={24} /></span>
      <div>
        <p>PAGE RECOVERY</p>
        <h1>这个页面刚才没有完成渲染。</h1>
        <span>
          其他页面、数据库和后台增量服务仍保持运行。你可以原地重试，或先返回首页；
          系统不会把内部错误或聊天内容显示在这里。
        </span>
      </div>
      <footer>
        <button type="button" onClick={() => {
          rememberPageRecoveryRoute(
            window.sessionStorage,
            `${location.pathname}${location.search}${location.hash}`
          )
          window.location.reload()
        }}>
          <RefreshCw size={14} />重新加载并打开当前页面
        </button>
        <button type="button" className="primary" onClick={() => navigate('/home', { replace: true })}>
          返回首页
        </button>
      </footer>
    </section>
  )

  return <ErrorBoundary key={boundaryKey} fallback={fallback}>{children}</ErrorBoundary>
}
