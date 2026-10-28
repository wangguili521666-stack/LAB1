import { offsetMinutes } from './time.js'

function integer(env, key, fallback, min, max) {
  const value = env[key] ?? String(fallback)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${key} 配置无效`)
  }
  return Number(value)
}

function required(env, key) {
  if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`缺少 ${key} 配置`)
  return env[key]
}

function serviceUrl(value, key) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${key} 必须为 HTTP(S) 服务地址`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${key} 必须为不含凭证或路径的 HTTP(S) 服务地址`)
  }
  return url.origin
}

export function loadConfig(env = process.env) {
  const d3BaseUrl = env.D3_BASE_URL ? serviceUrl(env.D3_BASE_URL, 'D3_BASE_URL') : null
  if (d3BaseUrl) required(env, 'D3_SERVICE_TOKEN')
  const serviceTokens = {}
  for (const module of ['M1', 'M2', 'M3']) {
    const token = env[`D2_${module}_SERVICE_TOKEN`]
    if (!token) continue
    if (token.length < 32 || /\s/.test(token) || Object.values(serviceTokens).includes(token)) {
      throw new Error('D2 服务密钥必须各不相同且不少于 32 个无空白字符')
    }
    serviceTokens[module] = token
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env, 'PORT', 3005, 1, 65535),
    db: {
      host: required(env, 'DB_HOST'),
      port: integer(env, 'DB_PORT', 3306, 1, 65535),
      database: required(env, 'DB_NAME'),
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASSWORD')
    },
    d1BaseUrl: serviceUrl(required(env, 'D1_BASE_URL'), 'D1_BASE_URL'),
    d3BaseUrl,
    d3ServiceToken: env.D3_SERVICE_TOKEN || null,
    dependencyTimeoutMs: integer(env, 'DEPENDENCY_TIMEOUT_MS', 3000, 100, 60000),
    auditPollMs: integer(env, 'AUDIT_POLL_MS', 2000, 100, 60000),
    serviceTokens,
    holdTtlSeconds: integer(env, 'HOLD_TTL_SECONDS', 300, 1, 86400),
    expiryPollMs: integer(env, 'EXPIRY_POLL_MS', 5000, 100, 60000),
    businessOffsetMinutes: offsetMinutes(env.BUSINESS_UTC_OFFSET || '+08:00')
  }
}
