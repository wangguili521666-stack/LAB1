import { invalid } from './errors.js'

const DAY = 86400000

export function offsetMinutes(value) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value)
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || (match[2] === '14' && match[3] !== '00')) {
    throw new Error('BUSINESS_UTC_OFFSET 必须为 -14:00..+14:00 的固定时区偏移')
  }
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
}

export function dateTime(value, name = '时间') {
  if (typeof value !== 'string') throw invalid(`${name} 必须为带时区的 ISO 8601 字符串`)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw invalid(`${name} 必须包含有效日期、秒和时区，最多三位毫秒`)
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y, m, d, h, min, s] = parts
  const local = new Date(Date.UTC(y, m - 1, d, h, min, s, Number(fraction.padEnd(3, '0'))))
  if (y < 1000 || local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d ||
      local.getUTCHours() !== h || local.getUTCMinutes() !== min || local.getUTCSeconds() !== s) throw invalid(`${name} 日期无效`)
  let offset
  try { offset = zone === 'Z' ? 0 : offsetMinutes(zone) } catch { throw invalid(`${name} 时区无效`) }
  const ms = local.getTime() - offset * 60000
  if (ms < Date.UTC(1000, 0, 1) || ms >= Date.UTC(10000, 0, 1)) throw invalid(`${name} 超出数据库时间范围`)
  return sqlTime(ms)
}

export const sqlTime = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, -1)
export const dbMillis = value => Date.parse(String(value).replace(' ', 'T') + 'Z')
export const isoTime = value => value === null ? null : new Date(dbMillis(value)).toISOString()

export async function databaseNow(connection) {
  const [[row]] = await connection.query('SELECT UTC_TIMESTAMP(3) AS now')
  return row.now
}

export function withinOpeningHours(parent, start, end, offset = 480) {
  const seconds = time => time.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000
  const open = seconds(parent.open_time)
  const close = seconds(parent.close_time)
  if (open === close) return true
  const startMs = dbMillis(start)
  const elapsed = dbMillis(end) - startMs
  const local = ((startMs + offset * 60000) % DAY + DAY) % DAY
  if (open < close) return local >= open && local < close && elapsed <= close - local
  if (local >= open) return elapsed <= DAY - local + close
  return local < close && elapsed <= close - local
}
