import { createHash, timingSafeEqual } from 'node:crypto'
import { ApiError, unavailable } from './errors.js'

const digest = value => createHash('sha256').update(value).digest()
export function serviceIdentity(header, credentials) {
  if (typeof header !== 'string' || !header || header.length > 512) throw new ApiError(401, 'UNAUTHORIZED', '缺少或无效的服务凭据')
  for (const [module, token] of Object.entries(credentials)) {
    if (timingSafeEqual(digest(header), digest(token))) return { module }
  }
  throw new ApiError(401, 'UNAUTHORIZED', '缺少或无效的服务凭据')
}

export function bearer(header) {
  if (typeof header !== 'string' || !/^Bearer \S{1,8192}$/.test(header)) throw new ApiError(401, 'UNAUTHORIZED', '请先登录')
  return header.slice(7)
}

// 用户身份和角色均由 D1 返回，不接受浏览器传入的 user_id、角色或管理员标记。
export function d1Authenticator({ baseUrl, timeoutMs = 3000, fetchImpl = fetch }) {
  return async header => {
    bearer(header)
    let response
    let envelope
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/d1/users/me`, {
        headers: { authorization: header }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error'
      })
      if ([401, 403, 404].includes(response.status)) throw new ApiError(401, 'UNAUTHORIZED', '登录已失效或账号不可用')
      if (!response.ok) throw unavailable()
      envelope = await response.json()
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw unavailable()
    }
    const user = envelope?.data
    if (envelope?.code !== 'OK' || !user || typeof user.id !== 'string' || !/^[1-9]\d{0,18}$/.test(user.id) ||
        BigInt(user.id) > 9223372036854775807n || !Array.isArray(user.roles) || !user.roles.every(role => typeof role === 'string') ||
        typeof user.status !== 'string') throw unavailable()
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'FORBIDDEN', '账号未启用')
    return { id: user.id, roles: user.roles }
  }
}

export function requireRole(user, roles) {
  if (!roles.some(role => user.roles.includes(role))) throw new ApiError(403, 'FORBIDDEN', '当前账号没有此操作权限')
}
