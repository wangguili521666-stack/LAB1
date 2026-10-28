export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const invalid = message => new ApiError(400, 'VALIDATION_ERROR', message)
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', '未登录或凭证无效')
export const forbidden = () => new ApiError(403, 'FORBIDDEN', '无权维护此资源')
export const notFound = () => new ApiError(404, 'NOT_FOUND', '资源不存在')
export const unavailable = name => new ApiError(503, 'DEPENDENCY_UNAVAILABLE', `${name}服务不可用`)

export function normalizeError(error) {
  if (error instanceof ApiError) return error
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    return invalid('请求 JSON 无效或超过大小限制')
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST',
    'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE',
    'ER_CON_COUNT_ERROR', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK'].includes(error?.code)) {
    return unavailable('数据库')
  }
  return new ApiError(500, 'INTERNAL_ERROR', '服务器内部错误')
}
