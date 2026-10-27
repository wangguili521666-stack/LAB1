import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { MemoryStore } from '../src/stores/memory.js'
import { MysqlStore, createPool } from '../src/stores/mysql.js'
import { mockServiceTokens, mockAuthenticate } from '../fixtures/identities.js'
import { migrate } from '../scripts/migrate.js'

let serial = 0
const mysqlConfig = process.env.D3_TEST_MYSQL ? JSON.parse(process.env.D3_TEST_MYSQL) : null
const tokens = { student: 'mock-student-101', other: 'mock-student-102', operator: 'mock-operator-103', admin: 'mock-admin-104' }

async function fixture(t, kind, options = {}) {
  const store = kind === 'mysql' ? new MysqlStore(createPool(mysqlConfig)) : new MemoryStore()
  if (kind === 'mysql') await migrate(store.pool)
  const prefix = ++serial * 10
  const users = { student: String(prefix + 101), other: String(prefix + 102), operator: String(prefix + 103), admin: String(prefix + 104) }
  let now = new Date('2026-10-23T02:00:00.000Z')
  const messages = []
  const authenticateUser = async header => {
    const identity = await mockAuthenticate(header)
    return { ...identity, id: users[Object.keys(tokens).find(key => tokens[key] === header.slice(7))] }
  }
  const app = createApp({ store, authenticateUser, serviceTokens: mockServiceTokens, clock: () => now,
    logger: { error: value => messages.push(value) }, ...options })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/d3`
  const request = async (path, { method = 'GET', as, service, body, headers = {}, raw } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(as ? { authorization: `Bearer ${tokens[as] || as}` } : {}),
      ...(service ? { 'x-d3-service-token': mockServiceTokens[service] || service } : {}),
      ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers
    }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(10000) })
    const json = await response.json()
    assert.equal(json.request_id, response.headers.get('x-request-id'))
    assert.equal(typeof json.request_id, 'string')
    return { status: response.status, ...json }
  }
  const event = overrides => ({ source_event_id: randomUUID(), notification_type: 'BOOKING_REMINDER', biz_type: 'SEAT_BOOKING', biz_id: '501',
    recipient_user_ids: [users.student], title: '预约即将开始', content: '请按时签到。', occurred_at: now.toISOString(), ...overrides })
  const notify = body => request('/internal/notifications', { method: 'POST', service: 'M1', body })
  const announcement = () => ({ title: `测试公告-${randomUUID()}`, content: '开放时间调整', type: 'NOTICE' })
  return { request, event, notify, announcement, store, users, messages, advance: ms => { now = new Date(now.getTime() + ms) } }
}

for (const kind of ['memory', 'mysql']) {
  const check = (name, run) => test(`${kind}: ${name}`, { skip: kind === 'mysql' && !mysqlConfig }, async t => run(await fixture(t, kind), t))

  check('通知 → 个人消息 → 已读，读操作不能跨用户', async f => {
    const accepted = await f.notify(f.event({ recipient_user_ids: [f.users.student, f.users.other] }))
    assert.equal(accepted.status, 201)
    assert.equal(accepted.data.recipient_count, 2)
    assert.equal(typeof accepted.data.id, 'string')
    const inbox = await f.request('/messages/me', { as: 'student' })
    assert.equal(inbox.data.total, 1)
    const message = inbox.data.items[0]
    assert.equal(message.notification_id, accepted.data.id)
    assert.equal(message.is_read, false)
    assert.equal(message.is_active, true)
    assert.equal('payload_hash' in message, false)
    assert.equal((await f.request(`/messages/me/${message.id}`, { as: 'other' })).status, 404)
    assert.equal((await f.request(`/messages/me/${message.id}/read`, { method: 'POST', as: 'other', body: {} })).status, 404)
    assert.equal((await f.request('/messages/me/unread-count', { as: 'student' })).data.unread_count, 1)
    const read = await f.request(`/messages/me/${message.id}/read`, { method: 'POST', as: 'student', body: {} })
    f.advance(1000)
    const reread = await f.request(`/messages/me/${message.id}/read`, { method: 'POST', as: 'student', body: {} })
    assert.equal(reread.data.read_at, read.data.read_at)
    assert.equal(reread.data.is_read, true)
    assert.equal((await f.request('/messages/me?is_read=false', { as: 'student' })).data.total, 0)
    assert.equal((await f.request('/messages/me/unread-count', { as: 'student' })).data.unread_count, 0)
    assert.equal((await f.request('/messages/me/unread-count', { as: 'other' })).data.unread_count, 1)
    const logs = await f.request(`/admin/logs?action=MESSAGE_READ&user_id=${f.users.student}`, { as: 'admin' })
    assert.equal(logs.data.total, 1)
  })

  check('重复、并发与内容冲突：只保存一次，返回同一个 ID', async f => {
    const body = f.event({ recipient_user_ids: [f.users.other, f.users.student, f.users.student] })
    const replies = await Promise.all(Array.from({ length: 8 }, () => f.notify(body)))
    assert.equal(replies.filter(r => r.status === 201).length, 1)
    assert.equal(replies.filter(r => r.status === 200).length, 7, JSON.stringify(replies.map(r => ({ status: r.status, code: r.code }))))
    assert.equal(new Set(replies.map(r => r.data.id)).size, 1)
    const normalized = await f.notify({ ...body, recipient_user_ids: [f.users.student, f.users.other], channels: ['IN_APP'], trace_id: 'retry-trace' })
    assert.equal(normalized.status, 200)
    assert.equal(normalized.data.deduplicated, true)
    assert.equal((await f.notify({ ...body, content: '不同的内容' })).status, 409)
    assert.equal((await f.notify({ ...body, recipient_user_ids: [f.users.student] })).status, 409)
    assert.equal((await f.request('/messages/me', { as: 'student' })).data.total, 1)
  })

  check('失效和过期保留历史，不再计入有效未读；来源模块隔离', async f => {
    const accepted = await f.notify(f.event())
    assert.equal((await f.request(`/internal/notifications/${accepted.data.id}/invalidate`, { method: 'POST', service: 'M2', body: {} })).status, 404)
    const invalidated = await f.request(`/internal/notifications/${accepted.data.id}/invalidate`, { method: 'POST', service: 'M1', body: {} })
    f.advance(2000)
    const duplicate = await f.request(`/internal/notifications/${accepted.data.id}/invalidate`, { method: 'POST', service: 'M1', body: {} })
    assert.equal(duplicate.data.invalidated_at, invalidated.data.invalidated_at)
    const expiring = f.event({ expires_at: '2026-10-23T02:00:03.000Z' })
    await f.notify(expiring)
    assert.equal((await f.request('/messages/me/unread-count', { as: 'student' })).data.unread_count, 1)
    f.advance(1000)
    assert.equal((await f.request('/messages/me/unread-count', { as: 'student' })).data.unread_count, 0)
    const history = await f.request('/messages/me?is_read=false', { as: 'student' })
    assert.equal(history.data.total, 2)
    assert.ok(history.data.items.every(row => row.is_active === false))
    assert.equal((await f.notify(expiring)).status, 200)
  })

  check('身份、参数与未实现渠道明确失败，不能用用户令牌写内部接口', async f => {
    assert.equal((await f.request('/messages/me')).status, 401)
    assert.equal((await f.request('/messages/me', { as: 'bad-token' })).status, 401)
    assert.equal((await f.request('/internal/notifications', { method: 'POST', as: 'student', body: f.event() })).status, 401)
    assert.equal((await f.notify(f.event({ source_module: 'M2' }))).status, 403)
    const cases = [
      { recipient_user_ids: [] }, { recipient_user_ids: [101] }, { recipient_user_ids: ['0'] },
      { recipient_user_ids: ['9223372036854775808'] }, { source_event_id: undefined }, { content: '' },
      { occurred_at: '2026-10-23 02:00:00' }, { occurred_at: '2026-02-30T02:00:00Z' },
      { occurred_at: '2030-01-01T00:00:00Z' }, { expires_at: '2026-10-22T00:00:00Z' }, { user_id: '999' },
      { notification_type: 'BOOKING_REMINDER ' }, { biz_type: 'lowercase' }
    ]
    for (const patch of cases) assert.equal((await f.notify(f.event(patch))).status, 400, JSON.stringify(patch))
    const channel = await f.notify(f.event({ channels: ['EMAIL'] }))
    assert.equal(channel.status, 422)
    assert.equal(channel.code, 'CHANNEL_NOT_AVAILABLE')
    for (const query of ['page=0', 'page_size=101', 'page=1.2', 'is_read=yes', 'user_id=999', 'page=1&page=2']) {
      assert.equal((await f.request('/messages/me?' + query, { as: 'student' })).status, 400, query)
    }
    assert.equal((await f.request('/messages/me/99999999', { as: 'student' })).status, 404)
    assert.equal((await f.request('/messages/me/abc', { as: 'student' })).status, 400)
    assert.equal((await f.request('/internal/notifications', { method: 'POST', service: 'M1', raw: '{' })).status, 400)
    assert.equal((await f.request('/internal/notifications', { method: 'POST', service: 'M1', raw: JSON.stringify({ content: 'a'.repeat(70000) }) })).status, 413)
    assert.equal((await f.request('/messages/me', { as: 'student' })).data.total, 0)
  })

  check('消息分页稳定，BIGINT 用户 ID 无精度丢失', async f => {
    await f.notify(f.event({ title: '一' }))
    await f.notify(f.event({ title: '二' }))
    const first = await f.request('/messages/me?page_size=1', { as: 'student' })
    const second = await f.request('/messages/me?page=2&page_size=1', { as: 'student' })
    assert.equal(first.data.items[0].title, '二')
    assert.equal(second.data.items[0].title, '一')
    assert.equal(first.data.total, 2)
    const large = await f.notify(f.event({ recipient_user_ids: ['9007199254740993'] }))
    assert.equal(large.status, 201)
    const stored = await f.store.transaction(tx => tx.listMessages('9007199254740993', { page: 1, page_size: 100 }))
    assert.ok(stored.items.some(row => row.notification_id === large.data.id && row.recipient_user_id === '9007199254740993'))
  })

  check('公告草稿、发布、编辑、撤回、过期与版本冲突', async f => {
    const draft = await f.request('/announcements', { method: 'POST', as: 'operator', body: f.announcement() })
    assert.equal(draft.status, 201)
    const path = `/announcements/${draft.data.id}`
    assert.equal(draft.data.publisher_id, f.users.operator)
    assert.equal((await f.request(path)).status, 404)
    assert.equal((await f.request('/admin' + path, { as: 'operator' })).data.status, 'DRAFT')
    assert.equal((await f.request(path + '/withdraw', { method: 'POST', as: 'operator', body: { expected_version: 1 } })).status, 409)
    const published = await f.request(path + '/publish', { method: 'POST', as: 'operator', body: { expected_version: 1 } })
    assert.equal(published.data.version, 2)
    assert.equal((await f.request(path)).data.status, 'PUBLISHED')
    assert.equal((await f.request(path, { method: 'PATCH', as: 'operator', body: { expected_version: 2, title: '不能直接修改已发布内容' } })).status, 409)
    assert.equal((await f.request(path + '/withdraw', { method: 'POST', as: 'operator', body: { expected_version: 1 } })).status, 409)
    const withdrawn = await f.request(path + '/withdraw', { method: 'POST', as: 'operator', body: { expected_version: 2 } })
    assert.equal(withdrawn.data.status, 'WITHDRAWN')
    assert.equal((await f.request(path)).status, 404)
    const edited = await f.request(path, { method: 'PATCH', as: 'operator', body: { expected_version: 3, expires_at: '2026-10-23T02:00:01Z' } })
    assert.equal(edited.data.version, 4)
    await f.request(path + '/publish', { method: 'POST', as: 'operator', body: { expected_version: 4 } })
    f.advance(1000)
    assert.equal((await f.request(path)).status, 404)
    const publicList = await f.request('/announcements')
    assert.ok(publicList.data.items.every(row => row.id !== draft.data.id))
    assert.equal((await f.request('/admin' + path, { as: 'admin' })).data.status, 'PUBLISHED')
    const logs = await f.request(`/admin/logs?module=D3&user_id=${f.users.operator}&result=SUCCESS`, { as: 'admin' })
    assert.equal(logs.data.total, 5)
  })

  check('公告管理员和审计管理员权限分别检查', async f => {
    for (const as of [undefined, 'student']) {
      assert.equal((await f.request('/announcements', { method: 'POST', as, body: f.announcement() })).status, as ? 403 : 401)
      assert.equal((await f.request('/admin/announcements', { as })).status, as ? 403 : 401)
    }
    assert.equal((await f.request('/admin/logs', { as: 'operator' })).status, 403)
    assert.equal((await f.request('/announcements', { method: 'POST', as: 'admin', body: { ...f.announcement(), publisher_id: '999' } })).status, 400)
    assert.equal((await f.request('/announcements', { method: 'POST', as: 'operator', body: { ...f.announcement(), expires_at: '2020-01-01T00:00:00Z' } })).status, 400)
    assert.equal((await f.request('/admin/announcements?published_from=2026-10-24T00:00:00Z&published_to=2026-10-23T00:00:00Z', { as: 'admin' })).status, 400)
    assert.equal((await f.request('/announcements/99999999/publish', { method: 'POST', as: 'operator', body: { expected_version: 1 } })).status, 404)
  })

  check('并发修改公告：一个版本只允许成功一次', async f => {
    const draft = await f.request('/announcements', { method: 'POST', as: 'operator', body: f.announcement() })
    const path = `/announcements/${draft.data.id}`
    const results = await Promise.all(['A', 'B'].map(title => f.request(path, { method: 'PATCH', as: 'operator', body: { title, expected_version: 1 } })))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    assert.equal((await f.request('/admin' + path, { as: 'operator' })).data.version, 2)
  })

  check('审计日志可幂等追加、精确过滤，不提供修改/删除接口', async f => {
    const body = { module: 'M1', source_event_id: randomUUID(), user_id: f.users.student, action: 'BOOKING_CREATE',
      target_type: 'SEAT_BOOKING', target_id: '9007199254740993', result: 'SUCCESS', request_method: 'POST', request_path: '/api/m1/bookings' }
    const send = body => f.request('/internal/logs', { method: 'POST', service: 'M1', body })
    const replies = await Promise.all(Array.from({ length: 6 }, () => send(body)))
    assert.equal(replies.filter(r => r.status === 201).length, 1)
    assert.equal(new Set(replies.map(r => r.data.id)).size, 1)
    assert.equal((await send({ ...body, result: 'FAILURE' })).status, 409)
    assert.equal((await send({ ...body, module: 'M2' })).status, 403)
    assert.equal((await send({ ...body, request_path: '/bookings?token=secret' })).status, 400)
    assert.equal((await send({ ...body, password: 'fake-secret' })).status, 400)
    assert.equal((await send({ ...body, actor_type: 'SYSTEM' })).status, 400)
    const logs = await f.request(`/admin/logs?module=M1&user_id=${f.users.student}&action=BOOKING_CREATE&start_time=2026-10-23T02:00:00Z&end_time=2026-10-23T02:00:01Z`, { as: 'admin' })
    assert.equal(logs.data.total, 1)
    assert.equal(logs.data.items[0].target_id, '9007199254740993')
    assert.equal('payload_hash' in logs.data.items[0], false)
    assert.equal((await f.request(`/admin/logs?module=M1&user_id=${f.users.student}&end_time=2026-10-23T02:00:00Z`, { as: 'admin' })).data.total, 0)
    for (const method of ['PATCH', 'DELETE']) assert.equal((await f.request(`/internal/logs/${replies[0].data.id}`, { method, service: 'M1', body: {} })).status, 404)
    const oldContract = { ...body, source_event_id: undefined }
    assert.equal((await send(oldContract)).status, 201)
    assert.equal((await send(oldContract)).status, 201)
  })

  check('审计写入失败会回滚业务和消息收件人，重试仍能成功', async f => {
    const original = f.store.transaction.bind(f.store)
    f.store.transaction = work => original(tx => {
      const append = tx.appendLog.bind(tx)
      tx.appendLog = async record => {
        if (record.action === 'NOTIFICATION_ACCEPT' || record.action === 'ANNOUNCEMENT_PUBLISH') throw new Error('injected audit failure')
        return append(record)
      }
      return work(tx)
    })
    const event = f.event()
    assert.equal((await f.notify(event)).status, 500)
    assert.equal((await f.request('/messages/me', { as: 'student' })).data.total, 0)
    const draft = await f.request('/announcements', { method: 'POST', as: 'operator', body: f.announcement() })
    const path = `/announcements/${draft.data.id}`
    assert.equal((await f.request(path + '/publish', { method: 'POST', as: 'operator', body: { expected_version: 1 } })).status, 500)
    const unchanged = await f.request('/admin' + path, { as: 'operator' })
    assert.equal(unchanged.data.status, 'DRAFT')
    assert.equal(unchanged.data.version, 1)
    f.store.transaction = original
    assert.equal((await f.notify(event)).status, 201)
  })

  check('数据库故障返回 503，不暴露连接信息；失败日志只记录错误码', async f => {
    f.store.transaction = async () => { throw Object.assign(new Error('password=do-not-log'), { code: 'ECONNREFUSED' }) }
    const result = await f.request('/internal/notifications', { method: 'POST', service: 'M1', body: f.event() })
    assert.equal(result.status, 503)
    assert.equal(result.code, 'DEPENDENCY_UNAVAILABLE')
    assert.equal(JSON.stringify(result).includes('do-not-log'), false)
    assert.equal(JSON.stringify(f.messages).includes('do-not-log'), false)
    assert.ok(f.messages.some(row => row.code === 'AUDIT_WRITE_FAILED'))
  })
}
