import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from '../src/app.js'
import { mockAuthenticate, mockServiceTokens, mockUsers } from '../fixtures/identities.js'

const assets = fileURLToPath(new URL('./acceptance/', import.meta.url))
const actors = Object.fromEntries(Object.keys(mockUsers).map(token => [token.slice(5), { authorization: `Bearer ${token}` }]))
for (const [module, token] of Object.entries(mockServiceTokens)) actors[module] = { 'x-d3-service-token': token }
actors.public = {}

const permitted = {
  GET: /^\/api\/d3\/(health|messages\/me(?:\/unread-count|\/[1-9]\d*)?|announcements(?:\/[1-9]\d*)?|admin\/announcements(?:\/[1-9]\d*)?|admin\/logs)$/,
  POST: /^\/api\/d3\/(internal\/notifications(?:\/[1-9]\d*\/invalidate)?|internal\/logs|messages\/me\/[1-9]\d*\/read|announcements(?:\/[1-9]\d*\/(?:publish|withdraw))?)$/,
  PATCH: /^\/api\/d3\/announcements\/[1-9]\d*$/
}
const fail = (res, status, code, message) => {
  const requestId = randomUUID()
  return res.status(status).set('X-Request-Id', requestId).json({ code, message, data: null, request_id: requestId })
}
const success = (res, data) => {
  const requestId = randomUUID()
  return res.set('X-Request-Id', requestId).json({ code: 'OK', message: 'success', data, request_id: requestId })
}

// 只由 dev:local 引用。正式入口与内存 Mock 均不加载本地验收工具。
export function createLocalApp({ store, config, logger = console }) {
  if (process.env.NODE_ENV === 'production' || config.host !== '127.0.0.1' ||
    config.database.host !== '127.0.0.1' || config.database.database !== 'campus_d3_local' || config.database.user !== 'd3_local_app') {
    throw new Error('验收页面只允许本机 D3 开发库')
  }
  const app = express()
  const router = express.Router()
  const sessionKey = randomBytes(32).toString('base64url')
  app.disable('x-powered-by')

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" })
    const host = req.headers.host
    const localHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`]
    const localPeers = ['127.0.0.1', '::ffff:127.0.0.1', '::1']
    if (!localPeers.includes(req.socket.remoteAddress) || !localHosts.includes(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
      return fail(res, 403, 'LOCAL_ONLY', '请直接从本机地址打开验收页面')
    }
    next()
  })
  router.get('/session', (req, res) => success(res, { session_key: sessionKey, database: config.database.database,
    database_port: config.database.port, identity_mode: 'local-simulation' }))
  router.use(express.json({ limit: '64kb', strict: true }))
  router.use((req, res, next) => {
    if (req.path === '/request' || req.path === '/database') {
      if (req.headers['x-d3-local-key'] !== sessionKey) return fail(res, 403, 'LOCAL_SESSION_EXPIRED', '本地服务已重启或页面会话无效，请刷新页面')
    }
    next()
  })

  router.get('/database', async (req, res) => {
    try {
      if (store.kind !== 'mysql') throw new Error('MySQL required')
      // 独立 SQL 读回计数；只访问 D3 的固定表，不接受浏览器提供 SQL 或表名。
      const [rows] = await store.pool.query(`SELECT 'notifications' AS category, COUNT(*) AS records FROM d3_notifications
        UNION ALL SELECT 'messages', COUNT(*) FROM d3_notification_recipients
        UNION ALL SELECT 'announcements', COUNT(*) FROM announcements
        UNION ALL SELECT 'logs', COUNT(*) FROM operation_logs`)
      success(res, { storage: 'mysql', database: config.database.database, checked_at: new Date().toISOString(),
        counts: Object.fromEntries(rows.map(row => [row.category, String(row.records)])) })
    } catch {
      fail(res, 503, 'DEPENDENCY_UNAVAILABLE', '无法读取本地数据库，请检查 MySQL 服务后重试')
    }
  })

  router.post('/request', async (req, res) => {
    const input = req.body
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['actor', 'method', 'path', 'body'].includes(key)) ||
      !Object.hasOwn(actors, input.actor) || !Object.hasOwn(permitted, input.method) ||
      typeof input.path !== 'string' || input.path.length > 2048 || !input.path.startsWith('/api/d3/')) {
      return fail(res, 400, 'VALIDATION_ERROR', '验收请求的身份、方法或路径无效')
    }
    const origin = `http://127.0.0.1:${req.socket.localPort}`
    let target
    try { target = new URL(input.path, origin) } catch { return fail(res, 400, 'VALIDATION_ERROR', '接口路径无效') }
    if (target.origin !== origin || target.hash || !permitted[input.method].test(target.pathname) || (input.method === 'GET' && input.body !== undefined)) {
      return fail(res, 400, 'VALIDATION_ERROR', '此方法或接口不在本地验收范围内')
    }
    try {
      // 经真实 HTTP 进入现有认证、校验、业务事务与审计；假服务凭据只留在本地后端。
      const response = await fetch(target, { method: input.method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { ...actors[input.actor], ...(input.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: input.body === undefined ? undefined : JSON.stringify(input.body) })
      const result = await response.json()
      res.set('X-Request-Id', response.headers.get('x-request-id') || result.request_id)
      res.status(response.status).json(result)
    } catch {
      fail(res, 503, 'DEPENDENCY_UNAVAILABLE', '接口未返回完整结果；写操作可能已生效，请先刷新列表再决定是否重试')
    }
  })
  router.use(express.static(assets, { index: 'index.html', dotfiles: 'deny', fallthrough: false }))
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : error.status === 404 ? 404 : 500
    fail(res, status, status === 404 ? 'NOT_FOUND' : status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
      status === 404 ? '页面不存在' : status === 500 ? '验收页面暂时不可用' : '请求体无效或超过 64KB')
  })
  app.use('/local/d3', router)
  app.use(createApp({ store, authenticateUser: mockAuthenticate, serviceTokens: mockServiceTokens, corsOrigin: config.corsOrigin, logger }))
  return app
}
