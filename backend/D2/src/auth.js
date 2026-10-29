import { timingSafeEqual } from 'node:crypto'
import { forbidden, unauthorized } from './errors.js'

export function authenticate(d1, serviceTokens) {
  const services = Object.entries(serviceTokens).map(([module, token]) => [module, Buffer.from(token)])
  return (req, res, next) => {
    const header = req.get('Authorization') || ''
    if (!/^Bearer [^\s]+$/i.test(header)) return next(unauthorized())
    req.token = header.slice(7)
    const candidate = Buffer.from(req.token)
    for (const [module, token] of services) {
      if (candidate.length === token.length && timingSafeEqual(candidate, token)) {
        req.identity = { kind: 'service', module, id: null, roles: [], college_id: null }
        return next()
      }
    }
    d1.identity(req.token).then(identity => {
      req.identity = { ...identity, kind: 'user' }
      if (req.audit) req.audit.userId = identity.id
      next()
    }, next)
  }
}

export function requireRead(identity) {
  if (identity.kind === 'service' && !['M1', 'M2'].includes(identity.module)) throw forbidden()
}

export function requireService(identity, modules) {
  if (identity.kind !== 'service' || !modules.includes(identity.module)) throw forbidden()
}

export function requireReservationRead(identity) {
  if (identity.kind === 'service') return requireService(identity, ['M1', 'M2'])
  if (!identity.roles.includes('SYSTEM_ADMIN') && !(identity.roles.includes('CLASSROOM_ADMIN') && identity.college_id)) throw forbidden()
}
