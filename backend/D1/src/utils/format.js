import { config } from '../config.js'

// 将 MySQL DATETIME（"2026-10-22 14:00:00"）转为带时区的 ISO 8601 字符串。
// 简化处理：约定数据库按本地时区存储，这里直接拼接约定偏移，不做真实时区换算。
export function toIso(datetime) {
  if (!datetime) return null
  return String(datetime).replace(' ', 'T') + config.db.timezone
}
