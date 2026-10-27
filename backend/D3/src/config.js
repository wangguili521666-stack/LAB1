import 'dotenv/config'
import { MODULES } from './validation.js'

function number(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${name} 配置无效`)
  return result
}

export function databaseConfig(env = process.env) {
  if (!env.DB_PASSWORD) throw new Error('必须显式设置 D3 的 DB_PASSWORD')
  return {
    host: env.DB_HOST || '127.0.0.1', port: number(env.DB_PORT, 3306, 1, 65535, 'DB_PORT'),
    database: env.DB_NAME || 'campus_d3', user: env.DB_USER || 'd3_app', password: env.DB_PASSWORD
  }
}

export function runtimeConfig(env = process.env) {
  let serviceTokens
  try { serviceTokens = JSON.parse(env.D3_SERVICE_TOKENS || '{}') } catch { throw new Error('D3_SERVICE_TOKENS 必须是 JSON 对象') }
  if (!serviceTokens || typeof serviceTokens !== 'object' || Array.isArray(serviceTokens) || !Object.keys(serviceTokens).length ||
      Object.entries(serviceTokens).some(([module, token]) => !MODULES.filter(m => m !== 'D3').includes(module) ||
        typeof token !== 'string' || token.length < 32 || token.length > 512 || /\s/.test(token)) ||
      new Set(Object.values(serviceTokens)).size !== Object.keys(serviceTokens).length) {
    throw new Error('D3_SERVICE_TOKENS 需要按调用模块配置不同的凭据，每个 32–512 个非空白字符')
  }
  const baseUrl = env.D1_BASE_URL || 'http://127.0.0.1:3004'
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('D1_BASE_URL 必须是服务的 http(s) 来源地址')
  }
  return {
    database: databaseConfig(env), serviceTokens, d1: { baseUrl, timeoutMs: number(env.D1_TIMEOUT_MS, 3000, 100, 30000, 'D1_TIMEOUT_MS') },
    host: env.HOST || '127.0.0.1', port: number(env.PORT, 3006, 1, 65535, 'PORT'), corsOrigin: env.D3_CORS_ORIGIN || null
  }
}
