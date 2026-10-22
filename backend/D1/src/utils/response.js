import crypto from 'node:crypto'

// 统一成功/失败包装，格式见 docs/api/common.md
export function ok(data = null, message = 'success') {
  return { code: 'OK', message, data, request_id: crypto.randomUUID() }
}

export function fail(code, message, data = null) {
  return { code, message, data, request_id: crypto.randomUUID() }
}
