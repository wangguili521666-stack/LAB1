import { config } from '../config.js'
import { HttpError } from '../utils/httpError.js'

const PASS_THROUGH = new Set(['RESOURCE_CONFLICT', 'INVALID_STATE', 'DUPLICATE_OPERATION', 'NOT_FOUND', 'VALIDATION_ERROR'])

export async function serviceRequest(baseUrl, path, { method = 'GET', body, timeout } = {}) {
  const headers = { Accept: 'application/json' }
  if (config.internalToken) headers['X-Service-Token'] = config.internalToken
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout ?? config.dependencyTimeoutMs),
    })
  } catch {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '依赖服务不可用')
  }

  const json = await response.json().catch(() => null)
  if (response.ok && json?.code === 'OK') return json.data

  const code = json?.code || 'DEPENDENCY_UNAVAILABLE'
  const message = json?.message || '依赖服务不可用'
  if (response.status === 409 && PASS_THROUGH.has(code)) {
    throw new HttpError(409, code, message)
  }
  if (response.status === 404) throw new HttpError(404, 'NOT_FOUND', message)
  if ((response.status === 400 || response.status === 422) && PASS_THROUGH.has(code)) {
    throw new HttpError(response.status, code, message)
  }
  throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '依赖服务不可用')
}
