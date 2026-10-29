import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPool, MysqlStore } from '../src/stores/mysql.js'
import { D3Service } from '../src/service.js'
import { migrate } from '../scripts/migrate.js'

test('MySQL 迁移重放、重建连接后保留数据与库权限边界', { skip: !process.env.D3_TEST_MYSQL }, async () => {
  const config = JSON.parse(process.env.D3_TEST_MYSQL)
  let store = new MysqlStore(createPool(config))
  const ctx = { service: { module: 'M2' }, method: 'POST', path: '/api/d3/internal/notifications', ip: '127.0.0.1', requestId: randomUUID() }
  const userId = '9223372036854775806'
  const input = { source_event_id: randomUUID(), notification_type: 'APPROVAL_RESULT', biz_type: 'CLASSROOM_APPLICATION', biz_id: '77',
    recipient_user_ids: [userId], title: '审批结果', content: '审批已通过。', occurred_at: new Date().toISOString() }
  let notificationId
  let messageId
  let firstReadAt
  try {
    await migrate(store.pool)
    assert.equal((await migrate(store.pool)).applied, false)
    const service = new D3Service(store)
    notificationId = (await service.notify(input, ctx)).data.id
    const inbox = await service.listMessages({}, { user: { id: userId } })
    messageId = inbox.items.find(row => row.notification_id === notificationId).id
    firstReadAt = (await service.getMessage(messageId, { ...ctx, service: undefined, user: { id: userId } }, true)).read_at
    await store.check()
    await assert.rejects(store.pool.query('SELECT * FROM mysql.user'), error => ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(error.code))
  } finally { await store.close() }
  store = new MysqlStore(createPool(config))
  try {
    const service = new D3Service(store)
    const messages = await service.listMessages({}, { user: { id: userId } })
    assert.ok(messages.items.some(row => row.notification_id === notificationId && row.recipient_user_id === userId))
    const read = await service.getMessage(messageId, { user: { id: userId } })
    assert.equal(read.read_at, firstReadAt)
    assert.equal(read.is_read, true)
    const replay = await service.notify(input, ctx)
    assert.equal(replay.created, false)
    assert.equal(replay.data.id, notificationId)
  } finally { await store.close() }
})
