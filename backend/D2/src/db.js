import mysql from 'mysql2/promise'

export function createPool(db) {
  const pool = mysql.createPool({
    ...db,
    charset: 'utf8mb4',
    connectionLimit: 10,
    waitForConnections: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: 'Z'
  })
  // D2 的 DATETIME 统一存 UTC；TIME 主数据仍为原始每日开放/关闭时间。
  pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"))
  return pool
}

export async function transaction(pool, work) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally {
    connection.release()
  }
}
