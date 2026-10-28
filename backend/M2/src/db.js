import mysql from 'mysql2/promise'
import { config } from './config.js'

let pool

export function getPool() {
  if (!pool) {
    const db = config.db
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      timezone: db.timezone,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    })
  }
  return pool
}

export async function closePool() {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}
