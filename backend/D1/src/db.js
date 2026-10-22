import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  // BIGINT 以十进制字符串返回、DATETIME 以字符串返回，避免精度/时区问题
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true
})
