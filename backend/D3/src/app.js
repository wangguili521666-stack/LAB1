import { randomUUID } from 'node:crypto'
import express from 'express'
import { requireRole, serviceIdentity } from './auth.js'
import { ApiError, unavailable } from './errors.js'
import { D3Service } from './service.js'
import { object } from './validation.js'

const wrap = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next)
const context = req => ({ user: req.user, service: req.service, method: req.method,
  path: typeof req.route?.path === 'string' ? req.route.path.slice(0, 255) : '/unmatched', ip: req.ip, requestId: req.requestId })
const ok = (req, res, data, status = 200) => res.status(status).json({ code: 'OK', message: 'success', data, request_id: req.requestId })
const databaseError = error => /^ER_|^ECONN|^ETIMEDOUT|^PROTOCOL_|^EHOST|^ENET/.test(error.code || '') || error.fatal

export function createApp({ store, authenticateUser, serviceTokens, clock, corsOrigin = null, logger = console }) {
  const app = express()
  const service = new D3Service(store, clock)
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use((req, res, next) => {
    req.requestId = randomUUID()
    res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (corsOrigin && req.headers.origin === corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
    }
    next()
  })
  app.use(express.json({ limit: '64kb', strict: true }))
  const user = wrap(async (req, res, next) => { req.user = await authenticateUser(req.headers.authorization); next() })
  const operator = (req, res, next) => { try { if(!req.user.permissions?.includes('announcement:manage')) requireRole(req.user, ['SYSTEM_ADMIN']); next() } catch (error) { next(error) } }
  const auditor = (req, res, next) => { try { if(!req.user.permissions?.includes('audit:read')) requireRole(req.user, ['SYSTEM_ADMIN']); next() } catch (error) { next(error) } }
  const internal = (req, res, next) => { try { req.service = serviceIdentity(req.headers['x-d3-service-token'], serviceTokens); next() } catch (error) { next(error) } }

  app.get('/api/d3/health', wrap(async (req, res) => {
    try { await store.check() } catch { throw unavailable() }
    ok(req, res, { status: 'UP', storage: store.kind, channels: ['IN_APP'] })
  }))
  app.post('/api/d3/internal/notifications', internal, wrap(async (req, res) => {
    const result = await service.notify(req.body, context(req))
    ok(req, res, result.data, result.created ? 201 : 200)
  }))
  app.post('/api/d3/internal/notifications/:id/invalidate', internal, wrap(async (req, res) =>
    ok(req, res, await service.invalidate(req.params.id, req.body, context(req)))))
  app.post('/api/d3/internal/logs', internal, wrap(async (req, res) => {
    const result = await service.writeLog(req.body, context(req))
    ok(req, res, result.data, result.created ? 201 : 200)
  }))
  app.get('/api/d3/messages/me', user, wrap(async (req, res) => ok(req, res, await service.listMessages(req.query, context(req)))))
  app.get('/api/d3/messages/me/unread-count', user, wrap(async (req, res) => ok(req, res, await service.unread(context(req)))))
  app.get('/api/d3/messages/me/:id', user, wrap(async (req, res) => ok(req, res, await service.getMessage(req.params.id, context(req)))))
  app.post('/api/d3/messages/me/:id/read', user, wrap(async (req, res) => {
    object(req.body, [])
    ok(req, res, await service.getMessage(req.params.id, context(req), true))
  }))
  app.get('/api/d3/announcements', wrap(async (req, res) => ok(req, res, await service.listAnnouncements(req.query))))
  app.get('/api/d3/announcements/:id', wrap(async (req, res) => ok(req, res, await service.getAnnouncement(req.params.id))))
  app.get('/api/d3/admin/announcements', user, operator, wrap(async (req, res) => ok(req, res, await service.listAnnouncements(req.query, true))))
  app.get('/api/d3/admin/announcements/:id', user, operator, wrap(async (req, res) => ok(req, res, await service.getAnnouncement(req.params.id, true))))
  app.post('/api/d3/announcements', user, operator, wrap(async (req, res) => ok(req, res, await service.createAnnouncement(req.body, context(req)), 201)))
  app.patch('/api/d3/announcements/:id', user, operator, wrap(async (req, res) => ok(req, res, await service.changeAnnouncement(req.params.id, req.body, context(req), 'EDIT'))))
  app.post('/api/d3/announcements/:id/publish', user, operator, wrap(async (req, res) => ok(req, res, await service.changeAnnouncement(req.params.id, req.body, context(req), 'PUBLISH'))))
  app.post('/api/d3/announcements/:id/withdraw', user, operator, wrap(async (req, res) => ok(req, res, await service.changeAnnouncement(req.params.id, req.body, context(req), 'WITHDRAW'))))
  app.get('/api/d3/admin/logs', user, auditor, wrap(async (req, res) => ok(req, res, await service.listLogs(req.query))))
  app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在')))
  app.use((error, req, res, next) => {
    void (async () => {
      let failure = error
      if (!(failure instanceof ApiError)) {
        if (error.type === 'entity.parse.failed') failure = new ApiError(400, 'VALIDATION_ERROR', '请求体不是有效的 JSON')
        else if (error.type === 'entity.too.large') failure = new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 64KB')
        else if (databaseError(error)) failure = unavailable()
        else failure = new ApiError(500, 'INTERNAL_ERROR', '服务内部错误')
      }
      if (failure.status >= 500) logger.error({ request_id: req.requestId, code: failure.code })
      // 失败审计不保存请求体、令牌、错误堆栈或 URL 查询参数。
      if (req.method !== 'OPTIONS' && (req.method !== 'GET' || [401, 403].includes(failure.status))) {
        try { await service.failureAudit(context(req), failure) }
        catch { logger.error({ request_id: req.requestId, code: 'AUDIT_WRITE_FAILED' }) }
      }
      if (!res.headersSent) res.status(failure.status).json({ code: failure.code, message: failure.message, data: null, request_id: req.requestId })
    })().catch(next)
  })
  return app
}
