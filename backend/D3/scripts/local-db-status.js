import { loadLocalConfig } from './local-config.js'
import { createPool } from '../src/stores/mysql.js'

let pool
try {
  const { database } = await loadLocalConfig()
  pool = createPool(database)
  const [[server]] = await pool.query('SELECT DATABASE() AS db, CURRENT_USER() AS account, @@port AS port')
  console.log(`数据库：${server.db}；账号：${server.account}；端口：${server.port}`)
  const [counts] = await pool.query(`SELECT '通知事件' AS category, COUNT(*) AS records FROM d3_notifications
    UNION ALL SELECT '用户消息', COUNT(*) FROM d3_notification_recipients
    UNION ALL SELECT '公告', COUNT(*) FROM announcements
    UNION ALL SELECT '操作审计', COUNT(*) FROM operation_logs`)
  console.table(counts)
  const [announcements] = await pool.query('SELECT CAST(id AS CHAR) AS id, title, status, version FROM announcements ORDER BY id DESC LIMIT 5')
  if (announcements.length) { console.log('最近公告：'); console.table(announcements) }
  const [messages] = await pool.query(`SELECT CAST(r.id AS CHAR) AS id, CAST(r.recipient_user_id AS CHAR) AS user_id,
    n.title, r.read_at, n.invalidated_at FROM d3_notification_recipients r JOIN d3_notifications n ON n.id=r.notification_id ORDER BY r.id DESC LIMIT 5`)
  if (messages.length) { console.log('最近用户消息（时间为 UTC）：'); console.table(messages) }
} catch (error) {
  console.error(error.code ? `数据库查询失败：${error.code}` : error.message)
  process.exitCode = 1
} finally { if (pool) await pool.end() }
