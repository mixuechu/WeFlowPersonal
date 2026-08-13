export type PersonalUpdateAvailability = {
  enabled: boolean
  feedBaseUrl: string
  reason: string
}

export function resolvePersonalUpdateAvailability(input: {
  feedBaseUrl?: unknown
  explicitEnabled?: unknown
  developmentServer?: unknown
}): PersonalUpdateAvailability {
  if (String(input.developmentServer || '').trim()) {
    return {
      enabled: false,
      feedBaseUrl: '',
      reason: '开发环境不检查自动更新'
    }
  }
  const explicit = String(input.explicitEnabled ?? '').trim().toLowerCase()
  if (explicit === 'false' || explicit === '0') {
    return {
      enabled: false,
      feedBaseUrl: '',
      reason: '自动更新已由本机配置关闭'
    }
  }
  const rawFeed = String(input.feedBaseUrl || '').trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(rawFeed)
  } catch {
    return {
      enabled: false,
      feedBaseUrl: '',
      reason: '当前为本地固化版本，尚未配置受信任的更新源'
    }
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return {
      enabled: false,
      feedBaseUrl: '',
      reason: '更新源必须是未携带凭据的 HTTPS 地址'
    }
  }
  return {
    enabled: true,
    feedBaseUrl: parsed.toString().replace(/\/+$/, ''),
    reason: ''
  }
}
