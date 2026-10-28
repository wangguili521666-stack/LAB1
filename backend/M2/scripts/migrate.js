import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { config } from '../src/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

export async function runMigrations() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
    multipleStatements: true,
  })

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    const [appliedRows] = await conn.query('SELECT filename FROM schema_migrations')
    const applied = new Set(appliedRows.map((row) => row.filename))
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort()

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file}`)
        continue
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      await conn.query(sql)
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
      console.log(`apply ${file}`)
    }
    console.log('迁移完成。')
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch((err) => {
    console.error('迁移失败：', err)
    process.exit(1)
  })
}
