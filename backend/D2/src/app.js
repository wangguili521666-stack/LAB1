import { randomUUID } from 'node:crypto'
import express from 'express'
import { auditPayload, enqueueAudit } from './audit.js'
import { normalizeError, notFound, unavailable, invalid } from './errors.js'
import { authenticate, requireRead, requireService, requireReservationRead } from './auth.js'
import { createReservationService } from './reservations.js'
import { createAvailabilityService } from './availability.js'
import { createMaintenanceService } from './maintenance.js'
import { createResourceService, requireCollege, requireMaintenance } from './resources.js'
import { classroomBody, seatBody, classroomQuery, seatQuery, noQuery, id,
  availabilityBody, reservationBody, transitionBody, maintenanceBody, reservationQuery } from './validation.js'

const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
const mutations = [
  ['POST', /^\/api\/d2\/classrooms$/, 'CLASSROOM_CREATE', 'CLASSROOM'],
  ['PATCH', /^\/api\/d2\/classrooms\/([^/]+)$/, 'CLASSROOM_UPDATE', 'CLASSROOM'],
  ['POST', /^\/api\/d2\/seats$/, 'SEAT_CREATE', 'SEAT'],
  ['PATCH', /^\/api\/d2\/seats\/([^/]+)$/, 'SEAT_UPDATE', 'SEAT'],
  ['POST', /^\/api\/d2\/reservations$/, 'RESERVATION_CREATE', 'RESERVATION'],
  ['POST', /^\/api\/d2\/reservations\/([^/]+)\/confirm$/, 'RESERVATION_CONFIRM', 'RESERVATION'],
  ['POST', /^\/api\/d2\/reservations\/([^/]+)\/release$/, 'RESERVATION_RELEASE', 'RESERVATION'],
  ['POST', /^\/api\/d2\/internal\/maintenance\/sync$/, 'MAINTENANCE_SYNC', 'REPAIR_TICKET']
]

function success(req, res, data, status = 200) {
  res.status(status).json({ code: 'OK', message: 'success', data, request_id: req.requestId })
}

export async function assertReady(pool) {
  const [rows] = await pool.query('SELECT filename FROM schema_migrations')
  if (!['001_resources.sql', '002_audit_outbox.sql', '003_reservations.sql', '004_maintenance.sql'].every(file => rows.some(row => row.filename === file))) {
    throw unavailable('数据库迁移')
  }
  await pool.query('SELECT id FROM classrooms LIMIT 0')
  await pool.query('SELECT id FROM seats LIMIT 0')
  await pool.query('SELECT id FROM operation_log_outbox LIMIT 0')
  await pool.query('SELECT id FROM resource_reservations LIMIT 0')
  await pool.query('SELECT ticket_id FROM maintenance_blocks LIMIT 0')
}

export function createApp({ pool, d1, serviceTokens = {}, reservationOptions = {}, report = console.error }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('query parser', 'simple')
  const resources = createResourceService(pool)
  const reservations = createReservationService(pool, reservationOptions)
  const available = createAvailabilityService(pool, reservationOptions.businessOffsetMinutes)
  const syncMaintenance = createMaintenanceService(pool)

  app.use((req, res, next) => {
    req.requestId = randomUUID()
    for (const [method, pattern, action, targetType] of mutations) {
      const match = req.method === method && pattern.exec(req.path)
      if (match) {
        let targetId = null
        try { if (match[1]) targetId = id(match[1]) } catch { /* 无效客户端 ID 不进入 BIGINT 审计字段。 */ }
        const path = match[1] ? `/api/d2/${targetType === 'RESERVATION' ? 'reservations' : targetType === 'CLASSROOM' ? 'classrooms' : 'seats'}/${targetId || ':id'}${targetType === 'RESERVATION' ? '/' + req.path.split('/').at(-1) : ''}` : req.path
        req.audit = { action, targetType, targetId, method: req.method, path, ip: req.ip, userId: null }
        break
      }
    }
    next()
  })
  app.use(express.json({ limit: '100kb', strict: true }))

  const authenticated = authenticate(d1, serviceTokens)
  const readable = (req, res, next) => { try { requireRead(req.identity); next() } catch (error) { next(error) } }
  function jsonInput(req, optional = false) {
    noQuery(req.query)
    if ((!optional || req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) && !req.is('application/json')) {
      throw invalid('请求体必须为 application/json')
    }
  }

  function writeInput(req) {
    requireMaintenance(req.identity)
    jsonInput(req)
  }

  app.get('/api/d2/health', wrap(async (req, res) => {
    noQuery(req.query)
    try { await assertReady(pool) } catch { throw unavailable('数据库') }
    success(req, res, { status: 'UP' })
  }))
  app.get('/api/d2/classrooms', authenticated, readable, wrap(async (req, res) => {
    success(req, res, await resources.listClassrooms(classroomQuery(req.query)))
  }))
  app.get('/api/d2/classrooms/:id', authenticated, readable, wrap(async (req, res) => {
    noQuery(req.query)
    success(req, res, await resources.getClassroom(id(req.params.id)))
  }))
  app.get('/api/d2/classrooms/:id/seats', authenticated, readable, wrap(async (req, res) => {
    success(req, res, await resources.listSeats(id(req.params.id), seatQuery(req.query)))
  }))
  app.get('/api/d2/seats/:id', authenticated, readable, wrap(async (req, res) => {
    noQuery(req.query)
    success(req, res, await resources.getSeat(id(req.params.id)))
  }))
  app.post('/api/d2/classrooms', authenticated, wrap(async (req, res) => {
    writeInput(req)
    const data = classroomBody(req.body)
    requireCollege(req.identity, data.college_id)
    if (data.college_id !== null) await d1.validateCollege(data.college_id, req.token)
    success(req, res, await resources.createClassroom(data, req.identity, req.audit), 201)
  }))
  app.patch('/api/d2/classrooms/:id', authenticated, wrap(async (req, res) => {
    writeInput(req)
    const classroomId = id(req.params.id)
    const data = classroomBody(req.body, true)
    if (Object.hasOwn(data, 'college_id')) {
      requireCollege(req.identity, data.college_id)
      if (data.college_id !== null) await d1.validateCollege(data.college_id, req.token)
    }
    success(req, res, await resources.patchClassroom(classroomId, data, req.identity, req.audit))
  }))
  app.post('/api/d2/seats', authenticated, wrap(async (req, res) => {
    writeInput(req)
    success(req, res, await resources.createSeat(seatBody(req.body), req.identity, req.audit), 201)
  }))
  app.patch('/api/d2/seats/:id', authenticated, wrap(async (req, res) => {
    writeInput(req)
    success(req, res, await resources.patchSeat(id(req.params.id), seatBody(req.body, true), req.identity, req.audit))
  }))
  for (const mode of ['search', 'check']) {
    app.post(`/api/d2/availability/${mode}`, authenticated, readable, wrap(async (req, res) => {
      jsonInput(req)
      success(req, res, await available[mode](availabilityBody(req.body, mode === 'search')))
    }))
  }
  app.post('/api/d2/reservations', authenticated, wrap(async (req, res) => {
    requireService(req.identity, ['M1', 'M2'])
    jsonInput(req)
    const result = await reservations.create(reservationBody(req.body), req.identity, req.audit)
    success(req, res, result.data, result.created ? 201 : 200)
  }))
  for (const mode of ['confirm', 'release']) {
    app.post(`/api/d2/reservations/:id/${mode}`, authenticated, wrap(async (req, res) => {
      requireService(req.identity, ['M1', 'M2'])
      jsonInput(req, true)
      transitionBody(req.body, mode === 'release')
      success(req, res, await reservations.transition(id(req.params.id), mode === 'release', req.identity, req.audit))
    }))
  }
  app.get('/api/d2/reservations', authenticated, wrap(async (req, res) => {
    requireReservationRead(req.identity)
    success(req, res, await reservations.list(reservationQuery(req.query), req.identity))
  }))
  app.get('/api/d2/reservations/:id', authenticated, wrap(async (req, res) => {
    requireReservationRead(req.identity)
    noQuery(req.query)
    success(req, res, await reservations.get(id(req.params.id), req.identity))
  }))
  app.post('/api/d2/internal/maintenance/sync', authenticated, wrap(async (req, res) => {
    requireService(req.identity, ['M3'])
    jsonInput(req)
    success(req, res, await syncMaintenance(maintenanceBody(req.body), req.identity, req.audit))
  }))
  app.use((req, res, next) => next(notFound()))

  app.use((rawError, req, res, next) => {
    const error = normalizeError(rawError)
    ;(async () => {
      if (req.audit) {
        try { await enqueueAudit(pool, auditPayload(req.audit, 'FAILURE')) } catch {
          report(JSON.stringify({ module: 'D2', event: 'AUDIT_PERSIST_FAILED', request_id: req.requestId }))
        }
      }
      if (error.status >= 500) {
        report(JSON.stringify({ module: 'D2', code: error.code, request_id: req.requestId }))
      }
      res.status(error.status).json({ code: error.code, message: error.message, data: null, request_id: req.requestId })
    })().catch(() => {
      if (!res.headersSent) res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误', data: null, request_id: req.requestId })
    })
  })
  return app
}
