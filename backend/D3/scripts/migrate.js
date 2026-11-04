import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { databaseConfig } from '../src/config.js'
import { createPool } from '../src/stores/mysql.js'

const firstFilename = '001_d3_core.sql'

export function migrationChecksums(sql) {
  // Git 在不同系统上可能转换 LF/CRLF；只统一换行，不忽略其他内容变化。
  const normalized = sql.replace(/\r\n/g, '\n')
  const hash = value => createHash('sha256').update(value).digest('hex')
  return { checksum: hash(normalized), legacyChecksum: hash(normalized.replace(/\n/g, '\r\n')) }
}

export async function migrate(pool) {
  const connection = await pool.getConnection()
  let lockName
  try {
    const [[db]] = await connection.query('SELECT DATABASE() AS name')
    lockName = `d3-migrate-${createHash('sha256').update(db.name).digest('hex').slice(0, 32)}`
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName])
    if (Number(lock.acquired) !== 1) throw new Error('另一个 D3 迁移正在运行')
    await connection.query(`CREATE TABLE IF NOT EXISTS d3_schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`)
    let changed = false;
    let filename = firstFilename;
    for (filename of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()) {
    const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
    const { checksum, legacyChecksum } = migrationChecksums(sql);
    const [applied] = await connection.query('SELECT checksum FROM d3_schema_migrations WHERE filename = ?', [filename])
    if (applied.length) {
      // 兼容旧版按原始 CRLF 内容计算的记录；不修改已保存的 checksum / applied_at。
      if (![checksum, legacyChecksum].includes(applied[0].checksum)) throw new Error('已执行的迁移文件发生变化；请新增迁移，禁止覆盖历史')
      continue
    }
    const [existing] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('d3_notifications', 'd3_notification_recipients', 'announcements', 'operation_logs')`)
    if (filename === firstFilename && existing.length) throw new Error('检测到已有 D3 表但没有匹配迁移记录；请先核对已有结构并设计增量迁移，本脚本不会覆盖或删除数据')
    // 本版本迁移不含存储过程；按语句执行，默认连接禁止 multipleStatements。
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement)
    await connection.query('INSERT INTO d3_schema_migrations (filename, checksum) VALUES (?, ?)', [filename, checksum])
    changed = true;
    }
    return { applied: changed, filename }
  } finally {
    if (lockName) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {})
    connection.release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool
  try {
    pool = createPool(databaseConfig())
    const result = await migrate(pool)
    console.log(`${result.filename}: ${result.applied ? '已执行' : '已执行过，校验通过'}`)
  } catch (error) {
    console.error(error.code ? `迁移失败：${error.code}` : error.message)
    process.exitCode = 1
  } finally { if (pool) await pool.end() }
}
