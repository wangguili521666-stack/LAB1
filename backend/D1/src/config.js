import 'dotenv/config'

export const config = {
  port: Number(process.env.PORT || 3004),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'campus_d1',
    user: process.env.DB_USER || 'd1_app',
    password: process.env.DB_PASSWORD || '',
    timezone: process.env.DB_TIMEZONE || '+08:00'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: Number(process.env.JWT_EXPIRES_IN || 86400)
  }
}
