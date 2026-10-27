import { createHash } from 'node:crypto'
import { ApiError, invalid } from './errors.js'

export const MODULES = ['M1', 'M2', 'M3', 'D1', 'D2', 'D3']
export const ANNOUNCEMENT_TYPES = ['NOTICE', 'MAINTENANCE', 'EMERGENCY']
export const RESULTS = ['SUCCESS', 'FAILURE', 'DENIED']

export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('请求体必须是 JSON 对象')
  const extra = Object.keys(value).filter(key => !keys.includes(key))
  if (extra.length) throw invalid(`不支持的字段：${extra.join(', ')}`)
  return value
}

export function string(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null)) return null
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\u0000')) {
    throw invalid(`${name} 必须是 1–${max} 字符的非空字符串`)
  }
  return value
}

export function id(value, name = 'id', optional = false) {
  if (optional && (value === undefined || value === null)) return null
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw invalid(`${name} 必须是正整数 ID 字符串`)
  }
  return value
}

export function choice(value, name, values) {
  if (!values.includes(value)) throw invalid(`${name} 必须为 ${values.join(' / ')}`)
  return value
}

export function instant(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw invalid(`${name} 必须是带时区的 ISO 8601 时间`)
  }
  const timestamp = Date.parse(value)
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (!Number.isFinite(timestamp) || year < 1000 || year > 9998 || month < 1 || month > 12 || day < 1 || day > days ||
      Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw invalid(`${name} 不是有效时间`)
  }
  return new Date(timestamp).toISOString()
}

export function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${name} 必须为 ${min}–${max} 的整数`)
  return value
}

export function pagination(query, allowed = []) {
  object(query, ['page', 'page_size', ...allowed])
  const parse = (value, fallback, name, max) => {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^[1-9]\d{0,6}$/.test(value)) throw invalid(`${name} 格式不正确`)
    return integer(Number(value), name, 1, max)
  }
  return { page: parse(query.page, 1, 'page', 1000000), page_size: parse(query.page_size, 20, 'page_size', 100) }
}

export function timeRange(query, from, to) {
  const start = instant(query[from], from, true)
  const end = instant(query[to], to, true)
  if (start && end && start >= end) throw invalid(`${from} 必须早于 ${to}`)
  return { [from]: start, [to]: end }
}

export function eventKey(value, optional = false) {
  const result = string(value, 'source_event_id', 128, optional)
  if (result && !/^[A-Za-z0-9_.:@/-]+$/.test(result)) throw invalid('source_event_id 仅支持 ASCII 字母、数字及 _ . : @ / -')
  return result
}

function eventType(value, name) {
  const result = string(value, name, 64)
  if (!/^[A-Z][A-Z0-9_]*$/.test(result)) throw invalid(`${name} 必须使用大写字母、数字和下划线，并以字母开头`)
  return result
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}
export const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

export function notificationInput(body, module, now) {
  object(body, ['source_module', 'source_event_id', 'notification_type', 'biz_type', 'biz_id', 'recipient_user_ids',
    'title', 'content', 'channels', 'occurred_at', 'expires_at', 'trace_id'])
  if (body.source_module !== undefined && body.source_module !== module) throw new ApiError(403, 'FORBIDDEN', '不能冒充其他来源模块')
  const channels = body.channels ?? ['IN_APP']
  if (!Array.isArray(channels) || channels.length !== 1 || channels[0] !== 'IN_APP') {
    throw new ApiError(422, 'CHANNEL_NOT_AVAILABLE', '本阶段仅提供 IN_APP 站内消息；邮件和微信尚未接入')
  }
  if (!Array.isArray(body.recipient_user_ids) || !body.recipient_user_ids.length || body.recipient_user_ids.length > 100) {
    throw invalid('recipient_user_ids 必须包含 1–100 个用户 ID')
  }
  const recipients = [...new Set(body.recipient_user_ids.map(value => id(value, 'recipient_user_ids')))].sort()
  const data = {
    source_module: module,
    source_event_id: eventKey(body.source_event_id),
    notification_type: eventType(body.notification_type, 'notification_type'),
    biz_type: eventType(body.biz_type, 'biz_type'),
    biz_id: string(body.biz_id, 'biz_id', 64),
    recipient_user_ids: recipients,
    title: string(body.title, 'title', 200),
    content: string(body.content, 'content', 10000),
    occurred_at: instant(body.occurred_at, 'occurred_at'),
    expires_at: instant(body.expires_at, 'expires_at', true)
  }
  if (Date.parse(data.occurred_at) > Date.parse(now) + 300000) throw invalid('occurred_at 不能超过当前时间 5 分钟')
  if (data.expires_at && data.expires_at <= data.occurred_at) throw invalid('expires_at 必须晚于 occurred_at')
  return { ...data, payload_hash: hash(data), trace_id: string(body.trace_id, 'trace_id', 64, true) }
}

export function announcementInput(body, patch = false) {
  object(body, ['title', 'content', 'type', 'expires_at', ...(patch ? ['expected_version'] : [])])
  const data = {}
  if (!patch || body.title !== undefined) data.title = string(body.title, 'title', 200)
  if (!patch || body.content !== undefined) data.content = string(body.content, 'content', 10000)
  if (!patch || body.type !== undefined) data.type = choice(body.type, 'type', ANNOUNCEMENT_TYPES)
  if (!patch || body.expires_at !== undefined) data.expires_at = instant(body.expires_at, 'expires_at', true)
  if (patch && !Object.keys(data).length) throw invalid('没有可修改的字段')
  return data
}
