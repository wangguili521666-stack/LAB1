import { ApiError, forbidden, unauthorized, unavailable } from './errors.js'
import { id } from './validation.js'

async function requestJson(baseUrl, path, options, timeoutMs, fetchImpl) {
  try {
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    })
    let body
    try { body = await response.json() } catch { throw unavailable('依赖') }
    return { response, body }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable('依赖')
  }
}

export function createD1Client({ baseUrl, timeoutMs, fetchImpl = fetch }) {
  async function get(path, token) {
    return requestJson(baseUrl, path, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs, fetchImpl)
  }
  return {
    async identity(token) {
      const { response, body } = await get('/api/d1/users/me', token)
      if (response.status === 401) throw unauthorized()
      if (response.status === 403) throw forbidden()
      if (!response.ok || body?.code !== 'OK') throw unavailable('D1')
      const user = body.data
      try {
        id(user.id)
        if (user.college_id !== null) id(user.college_id)
        if (!Array.isArray(user.roles) || user.roles.some(role => typeof role !== 'string')) throw Error()
        if (!['ACTIVE', 'DISABLED'].includes(user.status)) throw Error()
      } catch { throw unavailable('D1') }
      if (user.status !== 'ACTIVE') throw forbidden()
      // 不保留不必要的用户资料。
      return { id: user.id, college_id: user.college_id, roles: user.roles }
    },
    async validateCollege(collegeId, token) {
      const { response, body } = await get('/api/d1/colleges', token)
      // 404 表示依赖接口未实现，不能误判为“学院不存在”。
      if (response.status === 401) throw unauthorized()
      if (response.status === 403) throw forbidden()
      if (!response.ok || body?.code !== 'OK' || !Array.isArray(body.data)) throw unavailable('D1')
      try {
        for (const college of body.data) {
          id(college.id)
          if (typeof college.name !== 'string') throw Error()
        }
      } catch { throw unavailable('D1') }
      if (!body.data.some(college => college.id === collegeId)) {
        throw new ApiError(422, 'VALIDATION_ERROR', '学院不存在')
      }
    }
  }
}

export function createD3Sender({ baseUrl, token, timeoutMs, fetchImpl = fetch }) {
  return async payload => {
    if (!baseUrl || !token) throw unavailable('D3')
    const { response, body } = await requestJson(baseUrl, '/api/d3/internal/logs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, timeoutMs, fetchImpl)
    if (!response.ok || body?.code !== 'OK') throw unavailable('D3')
    try { id(body.data.id) } catch { throw unavailable('D3') }
  }
}
