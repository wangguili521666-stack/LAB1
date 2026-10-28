import { config } from '../config.js'
import { getPool } from '../db.js'
import { HttpError } from '../utils/httpError.js'
import { hasPermission, requirePermission } from '../clients/d1.js'
import * as d2 from '../clients/d2.js'
import { writeLog } from '../clients/d3.js'
import {
  addHours,
  assertRange,
  formatApplication,
  formatApproval,
  nowMysql,
  optionalId,
  optionalStatus,
  parseClientTime,
  readPage,
  requireId,
  requireText,
  toIso,
} from '../utils/format.js'

const LEVELS = {
  PENDING_L1: { level: 1, permission: 'classroom:approve_l1', next: 'PENDING_L2' },
  PENDING_L2: { level: 2, permission: 'classroom:approve_l2', next: 'APPROVED' },
}

function isWholeBookable(classroom) {
  const flag = classroom?.is_bookable_whole
  return flag === true || flag === 1 || flag === '1' || flag === 'true'
}

function collegeIdOf(classroom) {
  if (classroom?.college_id === undefined || classroom?.college_id === null || classroom.college_id === '') {
    return null
  }
  return String(classroom.college_id)
}

async function selectOne(executor, id) {
  const [rows] = await executor.query('SELECT * FROM classroom_applications WHERE id = ?', [id])
  return rows[0] || null
}

async function approvalsFor(executor, ids) {
  if (ids.length === 0) return new Map()
  const marks = ids.map(() => '?').join(', ')
  const [rows] = await executor.query(
    `SELECT * FROM application_approvals WHERE application_id IN (${marks}) ORDER BY approval_level ASC, id ASC`,
    ids,
  )
  const grouped = new Map()
  for (const row of rows) {
    const key = String(row.application_id)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(formatApproval(row))
  }
  return grouped
}

function detail(row, approvals) {
  return { application: formatApplication(row), approvals: approvals || [] }
}

async function canView(userId, row) {
  if (String(row.applicant_id) === String(userId)) return true
  if (await hasPermission({ userId, permissionCode: 'classroom:approve_l1' })) return true
  return hasPermission({ userId, permissionCode: 'classroom:approve_l2' })
}

export async function searchClassrooms(query) {
  const start = parseClientTime(query.start_time)
  const end = parseClientTime(query.end_time)
  assertRange(start, end)

  const filters = {}
  const collegeId = optionalId(query.college_id, '学院')
  if (collegeId) filters.college_id = collegeId
  if (typeof query.building === 'string' && query.building.trim()) {
    if (query.building.trim().length > 100) throw new HttpError(400, 'VALIDATION_ERROR', '教学楼名称过长')
    filters.building = query.building.trim()
  }
  if (typeof query.room_number === 'string' && query.room_number.trim()) {
    if (query.room_number.trim().length > 30) throw new HttpError(400, 'VALIDATION_ERROR', '教室编号过长')
    filters.room_number = query.room_number.trim()
  }
  if (query.min_capacity !== undefined && query.min_capacity !== '') {
    const capacity = Number(query.min_capacity)
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', '容量无效')
    }
    filters.min_capacity = capacity
  }

  const [rooms, availability] = await Promise.all([
    d2.listClassrooms(filters),
    d2.searchAvailability({ startTime: toIso(start), endTime: toIso(end), filters }),
  ])
  const availableIds = new Map()
  for (const item of Array.isArray(availability) ? availability : []) {
    availableIds.set(String(item.resource_id), Boolean(item.available))
  }

  return rooms.filter(isWholeBookable).map((room) => ({
    classroom_id: String(room.id),
    building: room.building,
    room_number: room.room_number,
    college_id: collegeIdOf(room),
    capacity: room.capacity,
    is_bookable_whole: true,
    available: availableIds.get(String(room.id)) === true,
  }))
}

async function ensureConfirmed(reservationId) {
  if (!reservationId) throw new HttpError(422, 'INVALID_STATE', '缺少资源预占，无法通过审批')
  try {
    await d2.confirmReservation(reservationId)
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 409) throw err
    const current = await d2.getReservation(reservationId)
    if (current?.status !== 'CONFIRMED') throw err
  }
}

async function ensureReleased(reservationId, reason) {
  if (!reservationId) return
  try {
    await d2.releaseReservation(reservationId, reason)
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 409) throw err
    const current = await d2.getReservation(reservationId)
    if (current?.status !== 'RELEASED') throw err
  }
}

export async function createApplication(userId, body, meta) {
  const classroomId = requireId(body?.classroom_id, '教室')
  const purpose = requireText(body?.purpose, '申请用途', 255)
  const start = parseClientTime(body?.start_time)
  const end = parseClientTime(body?.end_time)
  assertRange(start, end)

  const classroom = await d2.getClassroom(classroomId)
  if (classroom.status !== 'AVAILABLE' || !isWholeBookable(classroom)) {
    throw new HttpError(422, 'VALIDATION_ERROR', '该教室当前不能整间预约')
  }
  await requirePermission({
    userId,
    permissionCode: 'classroom:apply',
    resourceCollegeId: collegeIdOf(classroom),
  })

  const createdAt = nowMysql()
  const deadline = addHours(createdAt, config.approvalTimeoutHours)
  const [result] = await getPool().query(
    `INSERT INTO classroom_applications
      (applicant_id, classroom_id, purpose, start_time, end_time, status, approval_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING_L1', ?, ?, ?)`,
    [userId, classroomId, purpose, start, end, deadline, createdAt, createdAt],
  )
  const id = String(result.insertId)
  let reservationId = null

  try {
    const reservation = await d2.createReservation({
      resource_type: 'CLASSROOM',
      resource_id: classroomId,
      source_module: 'M2',
      source_id: id,
      start_time: toIso(start),
      end_time: toIso(end),
      hold_expires_at: toIso(deadline),
    })
    reservationId = requireId(reservation?.id, '预占')
    await getPool().query(
      'UPDATE classroom_applications SET reservation_id = ?, updated_at = ? WHERE id = ?',
      [reservationId, nowMysql(), id],
    )
  } catch (err) {
    if (reservationId) await ensureReleased(reservationId, 'CREATE_FAILED').catch(() => {})
    await getPool().query('DELETE FROM classroom_applications WHERE id = ? AND reservation_id IS NULL', [id])
    await writeLog({ ...meta, userId, action: 'APPLICATION_CREATE', targetId: id, result: 'FAILURE' })
    throw err
  }

  await writeLog({ ...meta, userId, action: 'APPLICATION_CREATE', targetId: id, result: 'SUCCESS' })
  return formatApplication(await selectOne(getPool(), id))
}

async function loadVisible(userId, id) {
  const row = await selectOne(getPool(), requireId(id, '申请'))
  if (!row) throw new HttpError(404, 'NOT_FOUND', '申请不存在')
  if (!(await canView(userId, row))) throw new HttpError(403, 'FORBIDDEN', '无权查看该申请')
  return row
}

export async function getApplication(userId, id) {
  const row = await loadVisible(userId, id)
  const grouped = await approvalsFor(getPool(), [row.id])
  return detail(row, grouped.get(String(row.id)))
}

export async function listApprovals(userId, id) {
  const row = await loadVisible(userId, id)
  const grouped = await approvalsFor(getPool(), [row.id])
  return grouped.get(String(row.id)) || []
}

async function pageApplications(whereSql, params, page, orderBy) {
  const pool = getPool()
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM classroom_applications ${whereSql}`, params)
  const [rows] = await pool.query(
    `SELECT * FROM classroom_applications ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, page.pageSize, page.offset],
  )
  return {
    items: rows.map(formatApplication),
    page: page.page,
    page_size: page.pageSize,
    total: Number(countRows[0].total),
  }
}

export async function listMine(userId, query) {
  const page = readPage(query)
  const status = optionalStatus(query.status)
  const params = [userId]
  let where = 'WHERE applicant_id = ?'
  if (status) {
    where += ' AND status = ?'
    params.push(status)
  }
  return pageApplications(where, params, page, 'id DESC')
}

export async function listAdmin(userId, query) {
  const allowed =
    (await hasPermission({ userId, permissionCode: 'classroom:approve_l1' })) ||
    (await hasPermission({ userId, permissionCode: 'classroom:approve_l2' }))
  if (!allowed) throw new HttpError(403, 'FORBIDDEN', '无权查看全部申请')

  const page = readPage(query)
  const clauses = []
  const params = []
  const status = optionalStatus(query.status)
  const classroomId = optionalId(query.classroom_id, '教室')
  const applicantId = optionalId(query.applicant_id, '申请人')
  if (status) {
    clauses.push('status = ?')
    params.push(status)
  }
  if (classroomId) {
    clauses.push('classroom_id = ?')
    params.push(classroomId)
  }
  if (applicantId) {
    clauses.push('applicant_id = ?')
    params.push(applicantId)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return pageApplications(where, params, page, 'id DESC')
}

export async function listPending(userId, query) {
  const levels = []
  if (await hasPermission({ userId, permissionCode: 'classroom:approve_l1' })) levels.push(1)
  if (await hasPermission({ userId, permissionCode: 'classroom:approve_l2' })) levels.push(2)

  let requested = null
  if (query.approval_level !== undefined && query.approval_level !== '') {
    requested = Number(query.approval_level)
    if (requested !== 1 && requested !== 2) throw new HttpError(400, 'VALIDATION_ERROR', '审批级别无效')
  }
  if (levels.length === 0 || (requested && !levels.includes(requested))) {
    throw new HttpError(403, 'FORBIDDEN', '没有对应级别的审批权限')
  }

  const use = requested ? [requested] : levels
  const statuses = use.map((level) => (level === 1 ? 'PENDING_L1' : 'PENDING_L2'))
  const page = readPage(query)
  const marks = statuses.map(() => '?').join(', ')
  const pool = getPool()
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM classroom_applications WHERE status IN (${marks})`,
    statuses,
  )
  const [rows] = await pool.query(
    `SELECT * FROM classroom_applications WHERE status IN (${marks}) ORDER BY approval_deadline ASC, id ASC LIMIT ? OFFSET ?`,
    [...statuses, page.pageSize, page.offset],
  )
  const grouped = await approvalsFor(pool, rows.map((row) => row.id))
  return {
    items: rows.map((row) => detail(row, grouped.get(String(row.id)))),
    page: page.page,
    page_size: page.pageSize,
    total: Number(countRows[0].total),
  }
}

async function withLocked(id, work) {
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const row = await selectOne(conn, id)
    if (!row) throw new HttpError(404, 'NOT_FOUND', '申请不存在')
    const [locked] = await conn.query('SELECT * FROM classroom_applications WHERE id = ? FOR UPDATE', [id])
    const result = await work(conn, locked[0])
    await conn.commit()
    return result
  } catch (err) {
    try {
      await conn.rollback()
    } catch {
      /* 事务可能尚未开始。 */
    }
    if (err?.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'DUPLICATE_OPERATION', '该级别已审批')
    throw err
  } finally {
    conn.release()
  }
}

export async function decide(userId, id, decision, comment, meta) {
  const applicationId = requireId(id, '申请')
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (decision === 'REJECTED' && !text) throw new HttpError(400, 'VALIDATION_ERROR', '驳回必须填写理由')
  if (text.length > 2000) throw new HttpError(400, 'VALIDATION_ERROR', '审批意见过长')

  const current = await selectOne(getPool(), applicationId)
  if (!current) throw new HttpError(404, 'NOT_FOUND', '申请不存在')
  const spec = LEVELS[current.status]
  if (!spec) throw new HttpError(409, 'INVALID_STATE', '当前状态不可审批')
  await requirePermission({ userId, permissionCode: spec.permission })

  await withLocked(applicationId, async (conn, row) => {
    if (row.status !== current.status) {
      throw new HttpError(409, 'DUPLICATE_OPERATION', '该申请已处理')
    }
    if (decision === 'APPROVED' && row.status === 'PENDING_L2') await ensureConfirmed(row.reservation_id)
    if (decision === 'REJECTED') await ensureReleased(row.reservation_id, 'REJECTED')

    const now = nowMysql()
    await conn.query(
      `INSERT INTO application_approvals
        (application_id, approval_level, approver_id, decision, comment, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [applicationId, spec.level, userId, decision, text || null, now],
    )
    await conn.query('UPDATE classroom_applications SET status = ?, updated_at = ? WHERE id = ?', [
      decision === 'APPROVED' ? spec.next : 'REJECTED',
      now,
      applicationId,
    ])
  })

  await writeLog({
    ...meta,
    userId,
    action: decision === 'APPROVED' ? 'APPLICATION_APPROVE' : 'APPLICATION_REJECT',
    targetId: applicationId,
    result: 'SUCCESS',
  })
  return formatApplication(await selectOne(getPool(), applicationId))
}

export async function cancelApplication(userId, id, meta) {
  const applicationId = requireId(id, '申请')
  const current = await selectOne(getPool(), applicationId)
  if (!current) throw new HttpError(404, 'NOT_FOUND', '申请不存在')
  if (String(current.applicant_id) !== String(userId)) throw new HttpError(403, 'FORBIDDEN', '只能撤销自己的申请')
  if (current.status !== 'PENDING_L1' && current.status !== 'PENDING_L2') {
    throw new HttpError(409, 'INVALID_STATE', '当前状态不可撤销')
  }

  await withLocked(applicationId, async (conn, row) => {
    if (String(row.applicant_id) !== String(userId)) throw new HttpError(403, 'FORBIDDEN', '只能撤销自己的申请')
    if (row.status !== 'PENDING_L1' && row.status !== 'PENDING_L2') {
      throw new HttpError(409, 'INVALID_STATE', '当前状态不可撤销')
    }
    await ensureReleased(row.reservation_id, 'CANCELLED')
    await conn.query(
      `UPDATE classroom_applications SET status = 'CANCELLED', updated_at = ? WHERE id = ?`,
      [nowMysql(), applicationId],
    )
  })

  await writeLog({ ...meta, userId, action: 'APPLICATION_CANCEL', targetId: applicationId, result: 'SUCCESS' })
  return formatApplication(await selectOne(getPool(), applicationId))
}

export async function expireOverdue() {
  const now = nowMysql()
  const [due] = await getPool().query(
    `SELECT id FROM classroom_applications
     WHERE status IN ('PENDING_L1', 'PENDING_L2') AND approval_deadline <= ?`,
    [now],
  )
  let expired = 0
  for (const item of due) {
    const done = await expireOne(String(item.id), now)
    if (done) expired += 1
  }
  await reconcileOrphans(now)
  return { expired }
}

async function expireOne(id, now) {
  try {
    const changed = await withLocked(id, async (conn, row) => {
      if (!['PENDING_L1', 'PENDING_L2'].includes(row.status) || String(row.approval_deadline) > now) return false
      await ensureReleased(row.reservation_id, 'EXPIRED')
      await conn.query(
        `UPDATE classroom_applications SET status = 'REJECTED', updated_at = ? WHERE id = ?`,
        [now, id],
      )
      return true
    })
    if (changed) {
      await writeLog({ userId: null, action: 'APPLICATION_EXPIRE', targetId: id, result: 'SUCCESS' })
    }
    return changed
  } catch (err) {
    console.error(`申请 ${id} 超时处理失败：`, err.message)
    return false
  }
}

async function reconcileOrphans(now) {
  const cutoff = addHours(now, -1 / 30)
  const [rows] = await getPool().query(
    `SELECT id FROM classroom_applications
     WHERE reservation_id IS NULL AND status IN ('PENDING_L1', 'PENDING_L2') AND created_at <= ?`,
    [cutoff],
  )
  for (const row of rows) {
    try {
      const found = await d2.listReservations({ source_module: 'M2', source_id: String(row.id) })
      const reservation = (found?.items || []).find((item) => item.status === 'HELD' || item.status === 'CONFIRMED')
      if (reservation) {
        await getPool().query(
          'UPDATE classroom_applications SET reservation_id = ?, updated_at = ? WHERE id = ? AND reservation_id IS NULL',
          [reservation.id, now, row.id],
        )
      } else {
        await getPool().query(
          `UPDATE classroom_applications SET status = 'REJECTED', updated_at = ? WHERE id = ? AND reservation_id IS NULL`,
          [now, row.id],
        )
      }
    } catch (err) {
      console.error(`悬挂申请 ${row.id} 对账失败：`, err.message)
    }
  }
}
