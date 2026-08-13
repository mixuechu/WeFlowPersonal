export type ConfirmableSystemNotification = {
  once: (event: 'show' | 'failed', listener: (...args: any[]) => void) => unknown
  removeListener: (event: 'show' | 'failed', listener: (...args: any[]) => void) => unknown
  show: () => void
  close: () => void
}

export async function showAndConfirmSystemNotification(
  notification: ConfirmableSystemNotification,
  timeoutMs = 3_000
): Promise<{ shown: boolean; error?: unknown }> {
  return new Promise(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (result: { shown: boolean; error?: unknown }) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      notification.removeListener('show', onShow)
      notification.removeListener('failed', onFailed)
      resolve(result)
    }
    const onShow = () => finish({ shown: true })
    const onFailed = (_event?: unknown, error?: unknown) => finish({
      shown: false,
      error: error || new Error('系统通知显示失败')
    })

    notification.once('show', onShow)
    notification.once('failed', onFailed)
    timer = setTimeout(() => {
      try {
        notification.close()
      } catch {}
      finish({
        shown: false,
        error: new Error('系统通知未在确认时间内显示')
      })
    }, Math.max(100, Math.floor(Number(timeoutMs) || 3_000)))

    try {
      notification.show()
    } catch (error) {
      finish({ shown: false, error })
    }
  })
}
