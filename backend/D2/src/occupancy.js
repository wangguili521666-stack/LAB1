import { setTimeout as pause } from 'node:timers/promises'
import { transaction } from './db.js'
import { notFound } from './errors.js'
import { withinOpeningHours } from './time.js'

// 并发来源键可能跨教室竞争；唯一约束或索引间隙导致的死锁只重试整个本地事务。
export async function occupancyTransaction(pool, work) {
  for (let attempt = 0; ; attempt++) {
    try { return await transaction(pool, work) } catch (error) {
      if (attempt >= 2 || !['ER_LOCK_DEADLOCK', 'ER_DUP_ENTRY'].includes(error.code)) throw error
      await pause(5 * (attempt + 1))
    }
  }
}

export async function loadResource(connection, type, resourceId, lock = false) {
  let seat = null
  let classroomId = resourceId
  if (type === 'SEAT') {
    const [rows] = await connection.query('SELECT classroom_id FROM seats WHERE id = ?', [resourceId])
    if (!rows.length) throw notFound()
    classroomId = String(rows[0].classroom_id)
  }
  const [parents] = await connection.query(`SELECT id, college_id, status, is_bookable_whole, open_time, close_time
    FROM classrooms WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [classroomId])
  if (!parents.length) throw notFound()
  if (type === 'SEAT') {
    const [rows] = await connection.query(`SELECT id, classroom_id, status FROM seats WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [resourceId])
    if (!rows.length) throw notFound()
    seat = rows[0]
  }
  return { parent: parents[0], seat }
}

export async function availability(connection, resource, data, now, offset, { lock = false, excludeId = null } = {}) {
  const { parent, seat } = resource
  let reason = null
  if (parent.status === 'DISABLED') reason = 'CLASSROOM_DISABLED'
  if (!reason) {
    const [blocks] = await connection.query(`SELECT ticket_id FROM maintenance_blocks
      WHERE classroom_id = ? AND active = 1${lock ? ' FOR UPDATE' : ''}`, [parent.id])
    if (parent.status === 'MAINTENANCE' || blocks.length) reason = 'CLASSROOM_MAINTENANCE'
  }
  if (!reason && seat?.status === 'DISABLED') reason = 'SEAT_DISABLED'
  if (!reason && seat?.status === 'MAINTENANCE') reason = 'SEAT_MAINTENANCE'
  if (!reason && data.resource_type === 'CLASSROOM' && !parent.is_bookable_whole) reason = 'WHOLE_BOOKING_NOT_ALLOWED'
  if (!reason && !withinOpeningHours(parent, data.start_time, data.end_time, offset)) reason = 'OUTSIDE_OPENING_HOURS'
  if (!reason) {
    const args = [parent.id, data.end_time, data.start_time, now]
    let scope = ''
    if (data.resource_type === 'SEAT') {
      scope += " AND (resource_type = 'CLASSROOM' OR (resource_type = 'SEAT' AND resource_id = ?))"
      args.push(data.resource_id)
    }
    if (excludeId !== null) { scope += ' AND id <> ?'; args.push(excludeId) }
    const [rows] = await connection.query(`SELECT id FROM resource_reservations
      WHERE classroom_id = ? AND start_time < ? AND end_time > ?
      AND (status = 'CONFIRMED' OR (status = 'HELD' AND hold_expires_at > ?))${scope}${lock ? ' FOR UPDATE' : ''}`, args)
    if (rows.length) reason = 'RESOURCE_CONFLICT'
  }
  return { resource_type: data.resource_type, resource_id: data.resource_id, classroom_id: String(parent.id), available: reason === null, reason }
}
