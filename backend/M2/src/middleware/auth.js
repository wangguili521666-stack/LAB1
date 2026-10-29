import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { fail } from '../utils/response.js'

export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json(fail('UNAUTHORIZED', '未登录'))

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (!payload?.sub) return res.status(401).json(fail('UNAUTHORIZED', 'Token 无效或已过期'))
    req.user = { id: String(payload.sub), username: payload.username }
    next()
  } catch {
    return res.status(401).json(fail('UNAUTHORIZED', 'Token 无效或已过期'))
  }
}

export function requestMeta(req) {
  return {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    ip: req.ip || null,
  }
}
