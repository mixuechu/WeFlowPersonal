export function unsupportedWcdbQueryParameterReason(params: unknown): string | null {
  if (!Array.isArray(params) || params.length === 0) return null
  return `WCDB 原生查询尚不支持参数绑定，已拒绝执行 ${params.length} 个未绑定参数`
}
