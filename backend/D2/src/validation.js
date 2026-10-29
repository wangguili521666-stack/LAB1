import { invalid } from './errors.js'
import { dateTime } from './time.js'

const MAX_ID = 9223372036854775807n
const STATUSES = ['AVAILABLE', 'MAINTENANCE', 'DISABLED']
const SOCKETS = ['NONE', 'FIXED', 'RAIL']
const own = (object, key) => Object.hasOwn(object, key)

export function id(value, name = 'id') {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_ID) {
    throw invalid(`${name} 必须为正的 BIGINT 十进制字符串`)
  }
  return value
}

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${name} 必须为对象`)
  return value
}

function fields(value, allowed, name) {
  object(value, name)
  if (Object.keys(value).some(key => !allowed.includes(key))) throw invalid(`${name} 包含不允许的字段`)
}

function text(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) {
    throw invalid(`${name} 必须为 1..${max} 个字符的字符串`)
  }
  return value.trim()
}

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid(`${name} 必须为 ${min}..${max} 的整数`)
  return value
}

function choice(value, values, name) {
  if (!values.includes(value)) throw invalid(`${name} 枚举无效`)
  return value
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw invalid(`${name} 必须为布尔值`)
  return value
}

function time(value, name) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) {
    throw invalid(`${name} 必须为有效的 HH:mm:ss`)
  }
  return value
}

const classroomRules = {
  building: value => text(value, 100, 'building'),
  room_number: value => text(value, 30, 'room_number'),
  college_id: value => value === null ? null : id(value, 'college_id'),
  capacity: value => integer(value, 1, 2147483647, 'capacity'),
  equipment: value => object(value, 'equipment'),
  status: value => choice(value, STATUSES, 'status'),
  is_bookable_whole: value => boolean(value, 'is_bookable_whole'),
  open_time: value => time(value, 'open_time'),
  close_time: value => time(value, 'close_time')
}
const seatRules = {
  classroom_id: value => id(value, 'classroom_id'),
  seat_number: value => text(value, 20, 'seat_number'),
  socket_type: value => choice(value, SOCKETS, 'socket_type'),
  status: value => choice(value, STATUSES, 'status')
}

function body(value, rules, allowed, required, defaults = {}) {
  fields(value, allowed, '请求体')
  for (const name of required) if (!own(value, name)) throw invalid(`缺少 ${name}`)
  if (Object.keys(value).length === 0) throw invalid('没有可修改的字段')
  const result = { ...defaults }
  for (const [name, input] of Object.entries(value)) result[name] = rules[name](input)
  return result
}

export function classroomBody(value, patch = false) {
  const allowed = Object.keys(classroomRules).filter(key => patch || key !== 'status')
  return body(value, classroomRules, allowed,
    patch ? [] : ['building', 'room_number', 'capacity', 'is_bookable_whole', 'open_time', 'close_time'],
    patch ? {} : { college_id: null, equipment: {}, status: 'AVAILABLE' })
}

export function seatBody(value, patch = false) {
  const allowed = patch ? ['seat_number', 'socket_type', 'status'] : ['classroom_id', 'seat_number', 'socket_type']
  return body(value, seatRules, allowed, patch ? [] : allowed, patch ? {} : { status: 'AVAILABLE' })
}

function queryInteger(value, min, max, name) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw invalid(`${name} 必须为十进制整数`)
  return integer(Number(value), min, max, name)
}

export function classroomQuery(value) {
  fields(value, ['college_id', 'building', 'room_number', 'min_capacity', 'status', 'is_bookable_whole', 'page', 'page_size'], '查询参数')
  const result = { page: 1, page_size: 20 }
  for (const [name, input] of Object.entries(value)) {
    if (name === 'page') result.page = queryInteger(input, 1, 2147483647, name)
    else if (name === 'page_size') result.page_size = queryInteger(input, 1, 100, name)
    else if (name === 'min_capacity') result[name] = queryInteger(input, 0, 2147483647, name)
    else if (name === 'is_bookable_whole') {
      if (!['true', 'false'].includes(input)) throw invalid(`${name} 必须为 true/false`)
      result[name] = input === 'true'
    } else result[name] = classroomRules[name](input)
  }
  return result
}

export function seatQuery(value) {
  fields(value, ['socket_type', 'status'], '查询参数')
  return Object.fromEntries(Object.entries(value).map(([name, input]) => [name, seatRules[name](input)]))
}

export function noQuery(value) {
  fields(value, [], '查询参数')
}

function interval(value) {
  const start_time = dateTime(value.start_time, 'start_time')
  const end_time = dateTime(value.end_time, 'end_time')
  if (start_time >= end_time) throw invalid('start_time 必须早于 end_time')
  return { start_time, end_time }
}

const resourceType = value => choice(value, ['SEAT', 'CLASSROOM'], 'resource_type')

export function availabilityBody(value, search = false) {
  fields(value, search ? ['resource_type', 'start_time', 'end_time', 'filters'] : ['resource_type', 'resource_id', 'start_time', 'end_time'], '请求体')
  const resource_type = resourceType(value.resource_type)
  const result = { resource_type, ...interval(value) }
  if (!search) return { ...result, resource_id: id(value.resource_id, 'resource_id') }
  const input = value.filters === undefined ? {} : value.filters
  const allowed = resource_type === 'SEAT' ? ['college_id', 'building', 'classroom_id', 'socket_type'] :
    ['college_id', 'building', 'room_number', 'min_capacity', 'is_bookable_whole']
  fields(input, allowed, 'filters')
  result.filters = {}
  for (const [key, inputValue] of Object.entries(input)) {
    if (key === 'classroom_id') result.filters[key] = id(inputValue, key)
    else if (key === 'socket_type') result.filters[key] = seatRules.socket_type(inputValue)
    else if (key === 'min_capacity') result.filters[key] = integer(inputValue, 0, 2147483647, key)
    else if (key === 'college_id') result.filters[key] = id(inputValue, key)
    else result.filters[key] = classroomRules[key](inputValue)
  }
  return result
}

export function reservationBody(value) {
  fields(value, ['resource_type', 'resource_id', 'source_module', 'source_id', 'start_time', 'end_time', 'hold_expires_at'], '请求体')
  const result = { resource_type: resourceType(value.resource_type), resource_id: id(value.resource_id, 'resource_id'),
    source_module: choice(value.source_module, ['M1', 'M2'], 'source_module'), source_id: id(value.source_id, 'source_id'), ...interval(value) }
  if (own(value, 'hold_expires_at')) result.hold_expires_at = dateTime(value.hold_expires_at, 'hold_expires_at')
  return result
}

export function transitionBody(value, release = false) {
  if (value === undefined) return {}
  fields(value, release ? ['reason'] : [], '请求体')
  return own(value, 'reason') ? { reason: text(value.reason, 255, 'reason') } : {}
}

export function maintenanceBody(value) {
  fields(value, ['ticket_id', 'classroom_id', 'active', 'revision'], '请求体')
  return { ticket_id: id(value.ticket_id, 'ticket_id'), classroom_id: id(value.classroom_id, 'classroom_id'),
    active: boolean(value.active, 'active'), revision: integer(value.revision, 1, 2147483647, 'revision') }
}

export function reservationQuery(value) {
  fields(value, ['source_module', 'source_id', 'resource_type', 'resource_id', 'status', 'page', 'page_size'], '查询参数')
  const result = { page: 1, page_size: 20 }
  for (const [key, input] of Object.entries(value)) {
    if (key === 'page') result.page = queryInteger(input, 1, 2147483647, key)
    else if (key === 'page_size') result.page_size = queryInteger(input, 1, 100, key)
    else if (key === 'source_module') result[key] = choice(input, ['M1', 'M2'], key)
    else if (key === 'resource_type') result[key] = resourceType(input)
    else if (key === 'status') result[key] = choice(input, ['HELD', 'CONFIRMED', 'RELEASED'], key)
    else result[key] = id(input, key)
  }
  return result
}
