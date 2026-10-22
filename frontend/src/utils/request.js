import { ref } from 'vue'

const token = ref(localStorage.getItem('token'))
export const isAuthenticated = () => !!token.value
export const getToken = () => token.value
export function setToken(value) {
  token.value = value || null
  if (value) localStorage.setItem('token', value)
  else localStorage.removeItem('token')
}
export const clearToken = () => setToken(null)
window.addEventListener('storage', (event) => {
  if (event.key === 'token' || event.key === null)
    token.value = localStorage.getItem('token')
})

export async function request(
  path,
  { method = 'GET', body, auth = true } = {},
) {
  const headers = {}
  const sentToken = getToken()
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && sentToken) headers.Authorization = `Bearer ${sentToken}`
  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    throw new Error(
      error.name === 'TimeoutError'
        ? '请求超时，请稍后重试'
        : '无法连接服务，请检查网络后重试',
    )
  }
  const json = await response.json().catch(() => null)
  if (response.status === 401 && auth && getToken() === sentToken) clearToken()
  if (!response.ok || json?.code !== 'OK') {
    const error = new Error(
      json?.message ||
        (response.status >= 500
          ? '服务暂时不可用，请稍后重试'
          : `请求失败（${response.status}）`),
    )
    error.status = response.status
    error.code = json?.code
    throw error
  }
  return json.data
}
