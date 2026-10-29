import { auditPayload, enqueueAudit } from './audit.js'
import { transaction } from './db.js'
import { forbidden, notFound } from './errors.js'

const CLASSROOM_COLUMNS = 'id, building, room_number, college_id, capacity, equipment, status, is_bookable_whole, open_time, close_time'
const SEAT_COLUMNS = 'id, classroom_id, seat_number, socket_type, status'

function classroom(row) {
  return {
    ...row,
    id: String(row.id),
    college_id: row.college_id === null ? null : String(row.college_id),
    equipment: typeof row.equipment === 'string' ? JSON.parse(row.equipment) : row.equipment,
    is_bookable_whole: Boolean(row.is_bookable_whole)
  }
}
const seat = row => ({ ...row, id: String(row.id), classroom_id: String(row.classroom_id) })

export function requireMaintenance(identity) {
  if (!identity.roles.includes('SYSTEM_ADMIN') && !identity.roles.includes('CLASSROOM_ADMIN')) throw forbidden()
}

export function requireCollege(identity, collegeId) {
  if (identity.roles.includes('SYSTEM_ADMIN')) return
  if (!identity.roles.includes('CLASSROOM_ADMIN') || !identity.college_id || collegeId !== identity.college_id) throw forbidden()
}

async function loadClassroom(connection, classroomId, lock = false) {
  const [rows] = await connection.query(
    `SELECT ${CLASSROOM_COLUMNS} FROM classrooms WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [classroomId])
  if (!rows.length) throw notFound()
  return classroom(rows[0])
}

async function loadSeat(connection, seatId, lock = false) {
  const [rows] = await connection.query(
    `SELECT ${SEAT_COLUMNS} FROM seats WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [seatId])
  if (!rows.length) throw notFound()
  return seat(rows[0])
}

async function insertedId(connection) {
  // insertId 在部分驱动路径上可能为 JS Number，不能再转字符串补救已丢失的精度。
  const [[row]] = await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id')
  return row.id
}

export function createResourceService(pool) {
  return {
    async listClassrooms(query) {
      return transaction(pool, async connection => {
        const clauses = []
        const parameters = []
        for (const key of ['college_id', 'building', 'room_number', 'status', 'is_bookable_whole']) {
          if (Object.hasOwn(query, key)) { clauses.push(`${key} = ?`); parameters.push(query[key]) }
        }
        if (Object.hasOwn(query, 'min_capacity')) { clauses.push('capacity >= ?'); parameters.push(query.min_capacity) }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
        const [[count]] = await connection.query(`SELECT COUNT(*) AS total FROM classrooms${where}`, parameters)
        const [rows] = await connection.query(
          `SELECT ${CLASSROOM_COLUMNS} FROM classrooms${where} ORDER BY id LIMIT ? OFFSET ?`,
          [...parameters, query.page_size, (query.page - 1) * query.page_size])
        return { items: rows.map(classroom), page: query.page, page_size: query.page_size, total: Number(count.total) }
      })
    },
    getClassroom: classroomId => loadClassroom(pool, classroomId),
    getSeat: seatId => loadSeat(pool, seatId),
    async listSeats(classroomId, query) {
      return transaction(pool, async connection => {
        await loadClassroom(connection, classroomId)
        const parameters = [classroomId]
        const clauses = ['classroom_id = ?']
        for (const key of ['socket_type', 'status']) {
          if (Object.hasOwn(query, key)) { clauses.push(`${key} = ?`); parameters.push(query[key]) }
        }
        const [rows] = await connection.query(`SELECT ${SEAT_COLUMNS} FROM seats WHERE ${clauses.join(' AND ')} ORDER BY id`, parameters)
        return rows.map(seat)
      })
    },
    async createClassroom(data, identity, context) {
      requireCollege(identity, data.college_id)
      return transaction(pool, async connection => {
        await connection.query(
          `INSERT INTO classrooms
           (building, room_number, college_id, capacity, equipment, status, is_bookable_whole, open_time, close_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [data.building, data.room_number, data.college_id, data.capacity, JSON.stringify(data.equipment),
            data.status, data.is_bookable_whole, data.open_time, data.close_time])
        const classroomId = await insertedId(connection)
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', classroomId))
        return loadClassroom(connection, classroomId)
      })
    },
    async patchClassroom(classroomId, data, identity, context) {
      return transaction(pool, async connection => {
        const current = await loadClassroom(connection, classroomId, true)
        requireCollege(identity, current.college_id)
        if (Object.hasOwn(data, 'college_id')) requireCollege(identity, data.college_id)
        const names = Object.keys(data)
        await connection.query(`UPDATE classrooms SET ${names.map(name => `${name} = ?`).join(', ')} WHERE id = ?`,
          [...names.map(name => name === 'equipment' ? JSON.stringify(data[name]) : data[name]), classroomId])
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', classroomId))
        return loadClassroom(connection, classroomId)
      })
    },
    async createSeat(data, identity, context) {
      return transaction(pool, async connection => {
        const parent = await loadClassroom(connection, data.classroom_id, true)
        requireCollege(identity, parent.college_id)
        await connection.query('INSERT INTO seats (classroom_id, seat_number, socket_type, status) VALUES (?, ?, ?, ?)',
          [data.classroom_id, data.seat_number, data.socket_type, data.status])
        const seatId = await insertedId(connection)
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', seatId))
        return loadSeat(connection, seatId)
      })
    },
    async patchSeat(seatId, data, identity, context) {
      return transaction(pool, async connection => {
        const current = await loadSeat(connection, seatId)
        const parent = await loadClassroom(connection, current.classroom_id, true)
        requireCollege(identity, parent.college_id)
        // classroom_id 不可修改。所有维护操作先锁教室，再锁座位，保持一致的锁顺序。
        await loadSeat(connection, seatId, true)
        const names = Object.keys(data)
        await connection.query(`UPDATE seats SET ${names.map(name => `${name} = ?`).join(', ')} WHERE id = ?`,
          [...names.map(name => data[name]), seatId])
        await enqueueAudit(connection, auditPayload(context, 'SUCCESS', seatId))
        return loadSeat(connection, seatId)
      })
    }
  }
}
