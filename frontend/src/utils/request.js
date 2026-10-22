// 统一 API 请求封装：处理 base、token、统一响应包装 { code, message, data, request_id }。
const TOKEN_KEY = 'token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json || json.code !== 'OK') {
    const err = new Error((json && json.message) || `请求失败（HTTP ${res.status}）`)
    err.code = json && json.code
    err.status = res.status
    throw err
  }

  return json.data
}
