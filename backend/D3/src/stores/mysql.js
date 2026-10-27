import mysql from 'mysql2/promise'

function rowFromSql(row) {
  if (!row) return null
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    key.endsWith('_at') && typeof value === 'string' ? new Date(value.replace(' ', 'T') + 'Z').toISOString() : value
  ]))
}
const sqlValue = (key, value) => key.endsWith('_at') && value ? new Date(value) : value
const columns = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, sqlValue(key, value)]))

const MESSAGE_SELECT = `SELECT r.id, r.notification_id, r.recipient_user_id, r.created_at, r.read_at,
  n.source_module, n.source_event_id, n.notification_type, n.biz_type, n.biz_id,
  n.title, n.content, n.trace_id, n.occurred_at, n.expires_at, n.invalidated_at
  FROM d3_notification_recipients r JOIN d3_notifications n ON n.id = r.notification_id`

class MysqlTransaction {
  constructor(connection) { this.connection = connection }
  async one(sql, values = []) {
    const [rows] = await this.connection.query(sql, values)
    return rowFromSql(rows[0])
  }
  // 表名与字段名只来自本文件及服务层构造的固定对象；用户值均使用参数绑定。
  async insert(table, data) {
    await this.connection.query(`INSERT INTO ${table} SET ?`, [columns(data)])
    const [rows] = await this.connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id')
    return this.one(`SELECT * FROM ${table} WHERE id = ?`, [rows[0].id])
  }
  async receiveNotification(data) {
    return this.insertOrRead('d3_notifications', data)
  }
  async insertOrRead(table, data) {
    // 原子 upsert 直接获取排他锁，避免多个重复 INSERT 持共享锁后升级的死锁。
    // 重复键只取原 ID，不覆盖内容；FOUND_ROWS 关闭后，首次插入为 1，未变更为 0。
    const [result] = await this.connection.query(`INSERT INTO ${table} SET ? ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [columns(data)])
    const [rows] = await this.connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id')
    return { created: result.affectedRows === 1, record: await this.one(`SELECT * FROM ${table} WHERE id = ?`, [rows[0].id]) }
  }
  async insertRecipients(notificationId, users, now) {
    await this.connection.query('INSERT INTO d3_notification_recipients (notification_id, recipient_user_id, created_at) VALUES ?',
      [users.map(userId => [notificationId, userId, new Date(now)])])
  }
  async getNotification(id) { return this.one('SELECT * FROM d3_notifications WHERE id = ? FOR UPDATE', [id]) }
  async invalidateNotification(id, now) {
    await this.connection.query('UPDATE d3_notifications SET invalidated_at = COALESCE(invalidated_at, ?) WHERE id = ?', [new Date(now), id])
    return this.getNotification(id)
  }
  async paged(select, count, where, values, filters) {
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const [totals] = await this.connection.query(count + clause, values)
    const [rows] = await this.connection.query(`${select}${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, filters.page_size, (filters.page - 1) * filters.page_size])
    return { items: rows.map(rowFromSql), total: Number(totals[0].total), page: filters.page, page_size: filters.page_size }
  }
  async listMessages(userId, filters) {
    const where = ['r.recipient_user_id = ?']
    const values = [userId]
    if (filters.is_read !== undefined) where.push(`r.read_at IS ${filters.is_read ? 'NOT ' : ''}NULL`)
    if (filters.source_module) { where.push('n.source_module = ?'); values.push(filters.source_module) }
    return this.paged(MESSAGE_SELECT, 'SELECT COUNT(*) total FROM d3_notification_recipients r JOIN d3_notifications n ON n.id = r.notification_id', where, values, filters)
  }
  async getMessage(userId, id) { return this.one(`${MESSAGE_SELECT} WHERE r.recipient_user_id = ? AND r.id = ? FOR UPDATE`, [userId, id]) }
  async markRead(userId, id, now) {
    await this.connection.query('UPDATE d3_notification_recipients SET read_at = COALESCE(read_at, ?) WHERE recipient_user_id = ? AND id = ?', [new Date(now), userId, id])
    return this.getMessage(userId, id)
  }
  async unreadCount(userId, now) {
    const result = await this.one(`SELECT COUNT(*) total FROM d3_notification_recipients r JOIN d3_notifications n ON n.id = r.notification_id
      WHERE r.recipient_user_id = ? AND r.read_at IS NULL AND n.invalidated_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > ?)`, [userId, new Date(now)])
    return Number(result.total)
  }
  async insertAnnouncement(data) { return this.insert('announcements', data) }
  async getAnnouncement(id) { return this.one('SELECT * FROM announcements WHERE id = ? FOR UPDATE', [id]) }
  async updateAnnouncement(id, changes) {
    await this.connection.query('UPDATE announcements SET ? WHERE id = ?', [columns(changes), id])
    return this.getAnnouncement(id)
  }
  async listAnnouncements(filters) {
    const where = []
    const values = []
    if (filters.public) {
      where.push("status = 'PUBLISHED'", 'published_at <= ?', '(expires_at IS NULL OR expires_at > ?)')
      values.push(new Date(filters.now), new Date(filters.now))
    }
    for (const field of ['type', 'status']) if (filters[field]) { where.push(`${field} = ?`); values.push(filters[field]) }
    if (filters.published_from) { where.push('published_at >= ?'); values.push(new Date(filters.published_from)) }
    if (filters.published_to) { where.push('published_at < ?'); values.push(new Date(filters.published_to)) }
    return this.paged('SELECT * FROM announcements', 'SELECT COUNT(*) total FROM announcements', where, values, filters)
  }
  async appendLog(data) {
    return this.insertOrRead('operation_logs', data)
  }
  async listLogs(filters) {
    const where = []
    const values = []
    for (const field of ['user_id', 'module', 'action', 'result']) if (filters[field]) { where.push(`${field} = ?`); values.push(filters[field]) }
    if (filters.start_time) { where.push('created_at >= ?'); values.push(new Date(filters.start_time)) }
    if (filters.end_time) { where.push('created_at < ?'); values.push(new Date(filters.end_time)) }
    return this.paged('SELECT * FROM operation_logs', 'SELECT COUNT(*) total FROM operation_logs', where, values, filters)
  }
}

export function createPool(config) {
  return mysql.createPool({ ...config, connectionLimit: 8, waitForConnections: true, queueLimit: 100,
    supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, timezone: 'Z', charset: 'utf8mb4', flags: '-FOUND_ROWS',
    connectTimeout: 3000, multipleStatements: false })
}

export class MysqlStore {
  constructor(pool) { this.pool = pool; this.kind = 'mysql' }
  async transaction(work) {
    for (let attempt = 0; ; attempt++) {
      const connection = await this.pool.getConnection()
      try {
        await connection.beginTransaction()
        const result = await work(new MysqlTransaction(connection))
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback().catch(() => {})
        if (attempt < 2 && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) continue
        throw error
      } finally { connection.release() }
    }
  }
  async check() {
    // 检查四张业务表与关键扩展列，避免部分迁移后错误报告就绪。
    await this.pool.query(`SELECT n.payload_hash, r.read_at, a.version, l.source_event_id
      FROM d3_notifications n, d3_notification_recipients r, announcements a, operation_logs l LIMIT 0`)
  }
  async close() { await this.pool.end() }
}
