import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { loadLocalConfig } from './local-config.js'

const local = process.argv.includes('--local')
const port = local ? (await loadLocalConfig()).port : Number(process.env.D3_MOCK_PORT || 3006)
const base = `http://127.0.0.1:${port}/api/d3`
async function call(path, { method = 'GET', token, service, body } = {}) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(5000), headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(service ? { 'x-d3-service-token': service } : {}),
    ...(body ? { 'content-type': 'application/json' } : {})
  }, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json()
  assert.equal(result.code, 'OK', `${response.status}: ${result.code}`)
  return result.data
}
const service = 'mock-m1-local-only'
const token = 'mock-student-101'
if (local) assert.equal((await call('/health')).storage, 'mysql', 'smoke:local 必须连接真实 MySQL 模式')
const body = { source_event_id: `smoke-${randomUUID()}`, notification_type: 'BOOKING_REMINDER', biz_type: 'SEAT_BOOKING', biz_id: '501',
  recipient_user_ids: ['101'], title: '预约即将开始', content: '请按时签到。', occurred_at: new Date().toISOString(), channels: ['IN_APP'] }
const created = await call('/internal/notifications', { method: 'POST', service, body })
const duplicate = await call('/internal/notifications', { method: 'POST', service, body })
assert.equal(duplicate.id, created.id)
assert.equal(duplicate.deduplicated, true)
const inbox = await call('/messages/me?page_size=100', { token })
const message = inbox.items.find(item => item.notification_id === created.id)
assert.ok(message)
const read = await call(`/messages/me/${message.id}/read`, { method: 'POST', token, body: {} })
assert.equal(read.is_read, true)
await call(`/internal/notifications/${created.id}/invalidate`, { method: 'POST', service, body: {} })
const history = await call(`/messages/me/${message.id}`, { token })
assert.equal(history.is_active, false)
console.log('通过：通知接收 → 重试去重 → 个人消息 → 标记已读 → 通知失效并保留历史。')
