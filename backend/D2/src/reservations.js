import { auditPayload, enqueueAudit } from './audit.js'
import { transaction } from './db.js'
import { requireReservationRead, requireService } from './auth.js'
import { ApiError, forbidden, notFound } from './errors.js'
import { availability, loadResource, occupancyTransaction } from './occupancy.js'
import { databaseNow, dbMillis, isoTime, sqlTime } from './time.js'

const columns = 'r.id, r.resource_type, r.resource_id, r.classroom_id, r.source_module, r.source_id, r.start_time, r.end_time, r.status, r.hold_expires_at'
export const effectiveStatus = (row, now) => row.status === 'HELD' && row.hold_expires_at <= now ? 'RELEASED' : row.status
export function reservationJson(row, now) {
  const status = effectiveStatus(row, now)
  return { id: String(row.id), resource_type: row.resource_type, resource_id: String(row.resource_id),
    classroom_id: String(row.classroom_id), source_module: row.source_module, source_id: String(row.source_id),
    start_time: isoTime(row.start_time), end_time: isoTime(row.end_time), status,
    hold_expires_at: status === 'HELD' ? isoTime(row.hold_expires_at) : null }
}
export async function loadReservation(connection, reservationId, lock = false) {
  const [rows] = await connection.query(`SELECT ${columns} FROM resource_reservations r WHERE r.id = ?${lock ? ' FOR UPDATE' : ''}`, [reservationId])
  if (!rows.length) throw notFound()
  return rows[0]
}
function readScope(identity, row) {
  if (identity.kind === 'service') {
    if (row.source_module !== identity.module) throw forbidden()
  } else if (!identity.roles.includes('SYSTEM_ADMIN') && String(row.college_id) !== identity.college_id) throw forbidden()
}
function owner(identity, row) {
  requireService(identity, ['M1', 'M2'])
  if (row.source_module !== identity.module) throw forbidden()
}
function conflict(result) {
  if (!result.available) throw new ApiError(409, 'RESOURCE_CONFLICT', `资源不可用：${result.reason}`)
}
const invalidState = () => new ApiError(409, 'INVALID_STATE', '预占已释放或过期，不能确认')

export function createReservationService(pool, { holdTtlSeconds = 300, businessOffsetMinutes = 480 } = {}) {
  return {
    async create(data, identity, context) {
      requireService(identity, ['M1', 'M2'])
      if (identity.module !== data.source_module || data.resource_type !== (identity.module === 'M1' ? 'SEAT' : 'CLASSROOM')) throw forbidden()
      return occupancyTransaction(pool, async connection => {
        const resource = await loadResource(connection, data.resource_type, data.resource_id, true)
        const now = await databaseNow(connection)
        const [existing] = await connection.query(`SELECT ${columns} FROM resource_reservations r
          WHERE source_module = ? AND source_id = ? FOR UPDATE`, [data.source_module, data.source_id])
        if (existing.length) {
          const row = existing[0]
          if (['resource_type', 'resource_id', 'start_time', 'end_time'].some(key => String(row[key]) !== data[key]) ||
              (data.hold_expires_at !== undefined && data.hold_expires_at !== row.hold_expires_at)) {
            throw new ApiError(409, 'DUPLICATE_OPERATION', '来源业务 ID 已用于不同的预占参数')
          }
          await enqueueAudit(connection, auditPayload(context, 'SUCCESS', row.id))
          return { data: reservationJson(row, now), created: false }
        }
        const deadline = data.hold_expires_at ?? sqlTime(dbMillis(now) + holdTtlSeconds * 1000)
        if (deadline <= now || deadline.slice(0, 4) > '9999') throw new ApiError(422, 'VALIDATION_ERROR', '预占截止必须晚于数据库当前时间')
        conflict(await availability(connection, resource, data, now, businessOffsetMinutes, { lock: true }))
        await connection.query(`INSERT INTO resource_reservations
          (resource_type, resource_id, classroom_id, source_module, source_id, start_time, end_time, status, hold_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'HELD', ?)`,
        [data.resource_type, data.resource_id, resource.parent.id, data.source_module, data.source_id, data.start_time, data.end_time, deadline])
        const [[inserted]] = await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id')
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', inserted.id))
        return { data: reservationJson(await loadReservation(connection, inserted.id, true), now), created: true }
      })
    },
    async transition(reservationId, release, identity, context) {
      requireService(identity, ['M1', 'M2'])
      const outcome = await occupancyTransaction(pool, async connection => {
        const reference = await loadReservation(connection, reservationId)
        owner(identity, reference)
        const resource = await loadResource(connection, reference.resource_type, String(reference.resource_id), true)
        const row = await loadReservation(connection, reservationId, true)
        owner(identity, row)
        const now = await databaseNow(connection)
        if (!release && effectiveStatus(row, now) === 'RELEASED') {
          if (row.status === 'HELD') {
            await connection.query("UPDATE resource_reservations SET status = 'RELEASED' WHERE id = ?", [reservationId])
            await enqueueAudit(connection, auditPayload({ ...context, action: 'RESERVATION_EXPIRE' }, 'SUCCESS', reservationId))
          }
          // 提交释放后再返回错误；不能在事务内抛错撤销过期转换。
          return { error: invalidState() }
        }
        if (!release && row.status !== 'CONFIRMED') {
          conflict(await availability(connection, resource, row, now, businessOffsetMinutes, { lock: true, excludeId: reservationId }))
        }
        const status = release ? 'RELEASED' : 'CONFIRMED'
        if (row.status !== status) await connection.query('UPDATE resource_reservations SET status = ? WHERE id = ?', [status, reservationId])
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', reservationId))
        return { data: reservationJson({ ...row, status }, now) }
      })
      if (outcome.error) throw outcome.error
      return outcome.data
    },
    async get(reservationId, identity) {
      requireReservationRead(identity)
      return transaction(pool, async connection => {
        const [rows] = await connection.query(`SELECT ${columns}, c.college_id FROM resource_reservations r
          JOIN classrooms c ON c.id = r.classroom_id WHERE r.id = ?`, [reservationId])
        if (!rows.length) throw notFound()
        readScope(identity, rows[0])
        return reservationJson(rows[0], await databaseNow(connection))
      })
    },
    async list(query, identity) {
      requireReservationRead(identity)
      return transaction(pool, async connection => {
        const now = await databaseNow(connection)
        const clauses = [], args = []
        if (identity.kind === 'service') { clauses.push('r.source_module = ?'); args.push(identity.module) }
        else if (!identity.roles.includes('SYSTEM_ADMIN')) { clauses.push('c.college_id = ?'); args.push(identity.college_id) }
        for (const key of ['source_module', 'source_id', 'resource_type', 'resource_id']) {
          if (query[key] !== undefined) { clauses.push(`r.${key} = ?`); args.push(query[key]) }
        }
        if (query.status) {
          clauses.push("(CASE WHEN r.status = 'HELD' AND r.hold_expires_at <= ? THEN 'RELEASED' ELSE r.status END) = ?")
          args.push(now, query.status)
        }
        const from = `FROM resource_reservations r JOIN classrooms c ON c.id = r.classroom_id${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''}`
        const [[count]] = await connection.query(`SELECT COUNT(*) AS total ${from}`, args)
        const [rows] = await connection.query(`SELECT ${columns} ${from} ORDER BY r.id LIMIT ? OFFSET ?`,
          [...args, query.page_size, (query.page - 1) * query.page_size])
        return { items: rows.map(row => reservationJson(row, now)), total: Number(count.total), page: query.page, page_size: query.page_size }
      })
    }
  }
}
