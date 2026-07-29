export type RecoveredMessageSemantics = {
  content: string
  semanticType: 'text' | 'image' | 'voice' | 'video' | 'emoji' | 'link' | 'file' | 'forward' | 'miniapp' | 'quote' | 'other'
  replyToMessageId: string
  quotedSender: string
  quotedContent: string
}

function semanticType(message: any, content: string): RecoveredMessageSemantics['semanticType'] {
  if (message?.quote || message?.replyToMessageId || Number(message?.localType) === 244813135921) return 'quote'
  if (/^\[链接\]/.test(content)) return 'link'
  if (/^\[文件\]/.test(content)) return 'file'
  if (/^\[聊天记录\]/.test(content)) return 'forward'
  if (/^\[小程序\]/.test(content)) return 'miniapp'
  if (Number(message?.localType) === 3 || /^\[图片\]/.test(content)) return 'image'
  if (Number(message?.localType) === 34 || /^\[语音\]/.test(content)) return 'voice'
  if (Number(message?.localType) === 43 || /^\[视频\]/.test(content)) return 'video'
  if (Number(message?.localType) === 47 || /^\[表情\]/.test(content)) return 'emoji'
  if (Number(message?.localType) === 1) return 'text'
  return 'other'
}

export function recoverMessageSemantics(message: any): RecoveredMessageSemantics {
  const original = String(message?.content || message?.parsedContent || '').trim()
  const quote = message?.quote && typeof message.quote === 'object' ? message.quote : {}
  const quotedSender = String(quote.sender || quote.accountName || '').trim()
  const quotedContent = String(quote.content || '').trim().slice(0, 800)
  const replyToMessageId = String(message?.replyToMessageId || quote.platformMessageId || '').trim()
  const context = quotedContent
    ? `[引用上下文｜${quotedSender ? `${quotedSender}：` : ''}${quotedContent}]`
    : ''
  const content = context && !original.includes(quotedContent)
    ? `${original || '[引用消息]'} ${context}`.slice(0, 2800)
    : original.slice(0, 2800)
  return {
    content,
    semanticType: semanticType(message, original),
    replyToMessageId,
    quotedSender,
    quotedContent
  }
}
