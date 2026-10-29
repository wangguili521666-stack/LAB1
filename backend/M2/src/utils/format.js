import { HttpError } from './httpError.js'

const ZONE = '+08:00'

export function toMysql(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 19).replace('T', ' ')
}

export function nowMysql() {
  return toMysql(new Date())
}

export function addHours(mysqlDatetime, hours) {
  const utc = new Date(String(mysqlDatetime).replace(' ', 'T') + 'Z')
  utc.setTime(utc.getTime() + hours * 60 * 60 * 1000)
  return utc.toISOString().slice(0, 19).replace('T', ' ')
}

export function toIso(datetime) {
  if (!datetime) return null
  const value = String(datetime).replace(' ', 'T')
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return value
  return `${value.slice(0, 19)}${ZONE}`
}

export function parseClientTime(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', '时间格式不正确')
  }
  const text = value.trim()
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw new HttpError(400, 'VALIDATION_ERROR', '时间必须是带时区的 ISO 8601 字符串')
  }
  return toMysql(new Date(text))
}

export function assertRange(start, end) {
  if (start >= end) {
    throw new HttpError(400, 'VALIDATION_ERROR', '结束时间必须晚于开始时间')
  }
}

export function requireId(value, label) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}无效`)
  }
  return text
}

export function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  return requireId(value, label)
}

export function requireText(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}不能为空`)
  }
  const text = value.trim()
  if (text.length > max) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}不能超过 ${max} 个字符`)
  }
  return text
}

export function readPage(query) {
  const page = query.page === undefined || query.page === '' ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined || query.page_size === '' ? 20 : Number(query.page_size)
  if (!Number.isInteger(page) || page < 1) {
    throw new HttpError(400, 'VALIDATION_ERROR', '页码无效')
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new HttpError(400, 'VALIDATION_ERROR', '每页数量须为 1 到 100')
  }
  return { page, pageSize, offset: (page - 1) * pageSize }
}

const STATUSES = new Set(['PENDING_L1', 'PENDING_L2', 'APPROVED', 'REJECTED', 'CANCELLED'])

export function optionalStatus(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (!STATUSES.has(value)) throw new HttpError(400, 'VALIDATION_ERROR', '申请状态无效')
  return value
}

export function formatApplication(row) {
  return {
    id: String(row.id),
    applicant_id: String(row.applicant_id),
    classroom_id: String(row.classroom_id),
    reservation_id: row.reservation_id == null ? null : String(row.reservation_id),
    purpose: row.purpose,
    start_time: toIso(row.start_time),
    end_time: toIso(row.end_time),
    status: row.status,
    approval_deadline: toIso(row.approval_deadline),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

export function formatApproval(row) {
  return {
    id: String(row.id),
    application_id: String(row.application_id),
    approval_level: Number(row.approval_level),
    approver_id: String(row.approver_id),
    decision: row.decision,
    comment: row.comment,
    decided_at: toIso(row.decided_at),
  }
}
