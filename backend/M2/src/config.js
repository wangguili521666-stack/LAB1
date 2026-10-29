import 'dotenv/config'

function num(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export const config = {
  get port() {
    return num('PORT', 3002)
  },
  get db() {
    return {
      host: process.env.DB_HOST || '127.0.0.1',
      port: num('DB_PORT', 3306),
      database: process.env.DB_NAME || 'campus_m2',
      user: process.env.DB_USER || 'm2_app',
      password: process.env.DB_PASSWORD || '',
      timezone: process.env.DB_TIMEZONE || '+08:00',
    }
  },
  get jwtSecret() {
    return process.env.JWT_SECRET || 'dev-secret-change-me'
  },
  get d1BaseUrl() {
    return process.env.D1_BASE_URL || 'http://127.0.0.1:3004'
  },
  get d2BaseUrl() {
    return process.env.D2_BASE_URL || 'http://127.0.0.1:3005'
  },
  get d3BaseUrl() {
    return process.env.D3_BASE_URL || 'http://127.0.0.1:3006'
  },
  get internalToken() {
    return process.env.INTERNAL_SERVICE_TOKEN || ''
  },
  get approvalTimeoutHours() {
    const hours = num('M2_APPROVAL_TIMEOUT_HOURS', 24)
    return hours > 0 ? hours : 24
  },
  get dependencyTimeoutMs() {
    return num('DEPENDENCY_TIMEOUT_MS', 8000)
  },
  get auditTimeoutMs() {
    return num('AUDIT_TIMEOUT_MS', 1500)
  },
  get expireIntervalMs() {
    return num('M2_EXPIRE_INTERVAL_MS', 60000)
  },
}
