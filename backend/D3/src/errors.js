export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    Object.assign(this, { status, code })
  }
}

export const invalid = message => new ApiError(400, 'VALIDATION_ERROR', message)
export const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在')
export const conflict = (message = '同一个事件标识对应了不同内容') =>
  new ApiError(409, 'RESOURCE_CONFLICT', message)
export const unavailable = () => new ApiError(503, 'DEPENDENCY_UNAVAILABLE', '依赖服务暂时不可用，请稍后重试')
