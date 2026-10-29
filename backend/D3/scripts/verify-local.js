import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { loadLocalConfig } from './local-config.js'
import { createPool } from '../src/stores/mysql.js'

const stateFile = new URL('../.local/last-verification.json', import.meta.url)
let pool
try {
  const config = await loadLocalConfig()
  const base = `http://127.0.0.1:${config.port}/api/d3`
  const call = async (path, { method = 'GET', body, user, module } = {}) => {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(5000), headers: {
      ...(user ? { authorization: `Bearer mock-${user}` } : {}),
      ...(module ? { 'x-d3-service-token': `mock-${module}-local-only` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body) })
    const result = await response.json()
    assert.equal(result.code, 'OK', `${method} ${path} 返回 ${response.status} ${result.code}`)
    return result.data
  }
  assert.equal((await call('/health')).storage, 'mysql', '当前服务不是 MySQL 模式')
  let state
  if (process.argv.includes('--recheck')) {
    state = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(state.database, config.database.database)
    assert.equal(state.database_port, config.database.port)
  } else {
    const runId = randomUUID()
    const notification = { source_event_id: `local:${runId}`, notification_type: 'BOOKING_REMINDER', biz_type: 'SEAT_BOOKING',
      biz_id: '501', recipient_user_ids: ['101'], title: '本地数据库通知验证', content: '这条消息会保存在 MySQL，重启后仍可查看。', occurred_at: new Date().toISOString() }
    const first = await call('/internal/notifications', { method: 'POST', module: 'm1', body: notification })
    const duplicate = await call('/internal/notifications', { method: 'POST', module: 'm1', body: notification })
    assert.equal(duplicate.id, first.id)
    assert.equal(duplicate.deduplicated, true)
    const inbox = await call('/messages/me?page_size=100', { user: 'student-101' })
    const message = inbox.items.find(row => row.notification_id === first.id)
    assert.ok(message, '本人消息列表未找到新通知')
    const read = await call(`/messages/me/${message.id}/read`, { method: 'POST', user: 'student-101', body: {} })
    assert.equal(read.is_read, true)
    let announcement = await call('/announcements', { method: 'POST', user: 'operator-103', body: {
      title: `本地数据库验证 ${runId.slice(0, 8)}`, content: '这是保存在本地 MySQL 中的公告，可在重启服务后查看。', type: 'NOTICE'
    } })
    announcement = await call(`/announcements/${announcement.id}`, { method: 'PATCH', user: 'operator-103',
      body: { expected_version: announcement.version, content: '公告创建、修改、发布、撤回和再次发布均已在本地数据库验证。' } })
    for (const action of ['publish', 'withdraw', 'publish']) {
      announcement = await call(`/announcements/${announcement.id}/${action}`, { method: 'POST', user: 'operator-103', body: { expected_version: announcement.version } })
    }
    const log = await call('/internal/logs', { method: 'POST', module: 'm2', body: {
      source_event_id: `local:${runId}`, user_id: '103', action: 'LOCAL_DATABASE_CHECK', target_type: 'ANNOUNCEMENT', target_id: announcement.id, result: 'SUCCESS'
    } })
    state = { database: config.database.database, database_port: config.database.port, notification_id: first.id,
      message_id: message.id, read_at: read.read_at, announcement_id: announcement.id, announcement_version: announcement.version, log_id: log.id }
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true })
    await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  }

  const message = await call(`/messages/me/${state.message_id}`, { user: 'student-101' })
  assert.equal(message.notification_id, state.notification_id)
  assert.equal(message.read_at, state.read_at)
  assert.equal(message.is_read, true)
  const announcement = await call(`/announcements/${state.announcement_id}`)
  assert.equal(announcement.status, 'PUBLISHED')
  assert.equal(announcement.version, state.announcement_version)
  const logs = await call('/admin/logs?module=M2&action=LOCAL_DATABASE_CHECK&page_size=100', { user: 'admin-104' })
  assert.ok(logs.items.some(row => row.id === state.log_id))

  // 使用独立数据库连接读回指定测试记录，确认不是仅在 API 内存中保存。
  pool = createPool(config.database)
  const [[storedMessage]] = await pool.query('SELECT CAST(notification_id AS CHAR) AS notification_id, read_at FROM d3_notification_recipients WHERE id = ?', [state.message_id])
  assert.equal(storedMessage.notification_id, state.notification_id)
  assert.equal(new Date(storedMessage.read_at.replace(' ', 'T') + 'Z').toISOString(), state.read_at)
  const [[storedAnnouncement]] = await pool.query('SELECT status, version FROM announcements WHERE id = ?', [state.announcement_id])
  assert.equal(storedAnnouncement.status, 'PUBLISHED')
  assert.equal(storedAnnouncement.version, state.announcement_version)
  const [[storedLog]] = await pool.query('SELECT action FROM operation_logs WHERE id = ?', [state.log_id])
  assert.equal(storedLog.action, 'LOCAL_DATABASE_CHECK')
  console.log('通过：通知去重、用户消息与已读、公告生命周期、审计查询；独立 MySQL 连接已读回业务记录。')
  console.log(`公告可查看：http://127.0.0.1:${config.port}/api/d3/announcements/${state.announcement_id}`)
  if (process.argv.includes('--recheck')) console.log('通过：上一次验证的数据与首次已读时间均保留。此次检查未创建新业务数据。')
  else console.log('可关闭并重新启动 dev:local，再运行 npm.cmd run verify:local -- --recheck 验证重启后数据保留。')
} catch (error) {
  console.error(error.code === 'ENOENT' ? '没有上一次验证记录，请先运行 npm.cmd run verify:local' :
    error.code && error.code !== 'ERR_ASSERTION' ? `验证失败：${error.code}` : error.message)
  process.exitCode = 1
} finally { if (pool) await pool.end() }
