export function sanitizeDiagnosticText(value: unknown): string {
  return String(value instanceof Error ? value.message : value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, '[已隐藏的 API Key]')
    .replace(/([?&](?:access_?token|api_?key|token|key)=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[已隐藏的长令牌]')
    .replace(/\bwxid_[A-Za-z0-9_-]+\b/gi, '[已隐藏的微信 ID]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[已隐藏的邮箱]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[本机用户]')
    .slice(0, 1000)
}
