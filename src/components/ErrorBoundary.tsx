import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  logError?: boolean
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (this.props.logError !== false) console.error('ErrorBoundary caught:', error, errorInfo)
    try {
      this.props.onError?.(error, errorInfo)
    } catch {
      // Diagnostic reporting must never replace the original recovery UI.
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
          <p>消息渲染出错</p>
          <p style={{ fontSize: '12px', marginTop: '8px' }}>
            {this.state.error?.message || '未知错误'}
          </p>
        </div>
      )
    }

    return this.props.children
  }
}
