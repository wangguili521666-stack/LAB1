import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { migrate, migrationChecksums } from '../scripts/migrate.js'
import { createPool } from '../src/stores/mysql.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const sqlPath = new URL('../migrations/001_d3_core.sql', import.meta.url)

test('迁移校验将 LF、CRLF 和混合换行视为相同内容，并兼容旧 CRLF 校验值', async () => {
  const lf = (await readFile(sqlPath, 'utf8')).replace(/\r\n/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')
  const mixed = lf.replace('\n', '\r\n')
  for (const source of [lf, crlf, mixed]) {
    const result = migrationChecksums(source)
    assert.equal(result.checksum, hash(lf))
    assert.equal(result.legacyChecksum, hash(crlf))
  }
  assert.notEqual(hash(lf), hash(crlf), '用例必须确实包含不同换行的原始内容')
})

test('迁移校验仍拒绝 SQL 内容、空格或注释变更', async () => {
  const original = await readFile(sqlPath, 'utf8')
  const saved = migrationChecksums(original)
  for (const changed of [original.replace('VARCHAR(200)', 'VARCHAR(201)'), `${original} `, `${original}-- changed\n`]) {
    const candidate = migrationChecksums(changed)
    assert.ok(![candidate.checksum, candidate.legacyChecksum].includes(saved.checksum))
    assert.ok(![candidate.checksum, candidate.legacyChecksum].includes(saved.legacyChecksum))
  }
})

test('MySQL 兼容旧 CRLF 记录，不重写历史，错误校验值仍拒绝且释放迁移锁', { skip: !process.env.D3_TEST_MYSQL }, async () => {
  const config = JSON.parse(process.env.D3_TEST_MYSQL)
  // 此用例会暂改迁移元数据，只允许隔离测试脚本创建的专用库/账号。
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.database, 'd3_isolated_test')
  assert.equal(config.user, 'd3_test')
  const pool = createPool(config)
  let saved
  try {
    await migrate(pool)
    const [[record]] = await pool.query('SELECT filename, checksum, applied_at FROM d3_schema_migrations WHERE filename = ?', ['001_d3_core.sql'])
    saved = record
    const sql = await readFile(sqlPath, 'utf8')
    const checksums = migrationChecksums(sql)
    assert.equal(record.checksum, checksums.checksum, '新迁移统一记录 LF 校验值')
    const [[before]] = await pool.query('SELECT COUNT(*) total FROM announcements')
    await pool.query('UPDATE d3_schema_migrations SET checksum = ? WHERE filename = ?', [checksums.legacyChecksum, record.filename])
    assert.deepEqual(await migrate(pool), { applied: false, filename: record.filename })
    const [[legacy]] = await pool.query('SELECT checksum, applied_at FROM d3_schema_migrations WHERE filename = ?', [record.filename])
    assert.equal(legacy.checksum, checksums.legacyChecksum)
    assert.equal(legacy.applied_at, record.applied_at)
    const [[after]] = await pool.query('SELECT COUNT(*) total FROM announcements')
    assert.equal(after.total, before.total)

    const changed = migrationChecksums(sql.replace('VARCHAR(200)', 'VARCHAR(201)'))
    for (const wrong of [changed.checksum, changed.legacyChecksum]) {
      await pool.query('UPDATE d3_schema_migrations SET checksum = ? WHERE filename = ?', [wrong, record.filename])
      await assert.rejects(migrate(pool), /已执行的迁移文件发生变化/)
      const [[current]] = await pool.query('SELECT checksum FROM d3_schema_migrations WHERE filename = ?', [record.filename])
      assert.equal(current.checksum, wrong, '不能自动覆盖不匹配的历史校验值')
    }
    const lockName = `d3-migrate-${hash(config.database).slice(0, 32)}`
    const [[lock]] = await pool.query('SELECT IS_FREE_LOCK(?) AS free', [lockName])
    assert.equal(Number(lock.free), 1)
  } finally {
    try {
      if (saved) await pool.query('UPDATE d3_schema_migrations SET checksum = ? WHERE filename = ?', [saved.checksum, saved.filename])
    } finally { await pool.end() }
  }
})
