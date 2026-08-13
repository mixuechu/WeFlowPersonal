export type RendererPermissionInput = {
  permission: string
  trustedMainFrame: boolean
  notificationRenderer: boolean
  platform: NodeJS.Platform
  mediaTypes?: string[]
  mediaType?: string
}

export const isAllowedRendererPermission = (input: RendererPermissionInput): boolean => {
  if (!input.trustedMainFrame) return false
  if (input.permission === 'clipboard-sanitized-write') return true
  if (input.permission !== 'media' && input.permission !== 'display-capture') return false
  if (input.platform !== 'win32' || !input.notificationRenderer) return false

  const requestedMedia = input.mediaTypes?.length
    ? input.mediaTypes
    : (input.mediaType ? [input.mediaType] : [])
  return requestedMedia.length === 0 || (
    requestedMedia.every(type => type === 'video') &&
    !requestedMedia.includes('audio')
  )
}
