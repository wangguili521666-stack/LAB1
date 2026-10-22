import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { fail } from '../utils/response.js'

// JWT 校验中间件：从 Authorization: Bearer <token> 提取并校验用户身份。
// 用户 ID 从可信认证上下文提取，不信任客户端传入的 user_id。
export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json(fail('UNAUTHORIZED', '未登录'))
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret)
    req.user = { id: payload.sub, username: payload.username }
    next()
  } catch {
    return res.status(401).json(fail('UNAUTHORIZED', 'Token 无效或已过期'))
  }
}
