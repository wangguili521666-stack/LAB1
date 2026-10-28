import crypto from 'node:crypto'

export function ok(data = null, message = 'success') {
  return { code: 'OK', message, data, request_id: crypto.randomUUID() }
}

export function fail(code, message, data = null) {
  return { code, message, data, request_id: crypto.randomUUID() }
}
