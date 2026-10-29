import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const directory = fileURLToPath(new URL('../migrations/', import.meta.url))

export async function migrate(db, report = console.log) {
  const connection = await mysql.createConnection({ ...db, charset: 'utf8mb4', multipleStatements: true })
  const lock = `d2_migrate_${createHash('sha256').update(db.database).digest('hex').slice(0, 32)}`
  let acquired = false
  try {
    await connection.query("SET time_zone = '+00:00'")
    const [[row]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lock])
    if (Number(row.acquired) !== 1) throw new Error('无法获得 D2 迁移锁')
    acquired = true
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    const [rows] = await connection.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map(row => row.filename))
    const files = (await fs.readdir(directory)).filter(file => /^\d{3}_[a-z_]+\.sql$/.test(file)).sort()
    for (const file of files) {
      if (applied.has(file)) { report(`skip  ${file}`); continue }
      // MySQL DDL 不是可回滚的事务；每个 CREATE IF NOT EXISTS 允许失败后重放。
      await connection.query(await fs.readFile(path.join(directory, file), 'utf8'))
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
      report(`apply ${file}`)
    }
  } finally {
    if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {})
    await connection.end()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await import('dotenv/config')
    const { loadConfig } = await import('../src/config.js')
    await migrate(loadConfig().db)
    console.log('D2 迁移完成。')
  } catch (error) {
    console.error(`D2 迁移失败（${error.code || 'CONFIG_OR_MIGRATION_ERROR'}），请检查配置和迁移状态。`)
    process.exitCode = 1
  }
}
