import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { get } from 'node:http'
import { createLocalApp } from '../scripts/acceptance-app.js'
import { createApp } from '../src/app.js'
import { MemoryStore } from '../src/stores/memory.js'
import { mockAuthenticate, mockServiceTokens } from '../fixtures/identities.js'

const config = { host: '127.0.0.1', port: 3106, database: { host: '127.0.0.1', port: 3306, database: 'campus_d3_local', user: 'd3_local_app' } }
async function fixture(t, app) {
  const store = new MemoryStore()
  const server = (app || createLocalApp({ store, config })).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close() })
  const origin = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${origin}/local/d3/session`)
  const session = response.status === 200 ? (await response.json()).data : null
  const request = async (actor, method, path, body, headers = {}) => {
    const response = await fetch(`${origin}/local/d3/request`, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-d3-local-key': session?.session_key || '', ...headers },
      body: JSON.stringify({ actor, method, path: `/api/d3${path}`, ...(body === undefined ? {} : { body }) }) })
    const result = await response.json()
    assert.equal(result.request_id, response.headers.get('x-request-id'))
    return { status: response.status, ...result }
  }
  return { origin, request, session }
}

test('验收页面可以加载，凭据不进入 HTML/JS，浏览器仅拿本地会话键', async t => {
  const f = await fixture(t)
  for (const path of ['/', '/app.js', '/styles.css']) {
    const response = await fetch(`${f.origin}/local/d3${path}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const text = await response.text()
    assert.doesNotMatch(text, /mock-m1-local-only|mock-student-101|DB_PASSWORD/)
  }
  assert.equal(f.session.database, 'campus_d3_local')
  assert.equal(typeof f.session.session_key, 'string')
  assert.equal(Object.hasOwn(f.session, 'password'), false)
})

test('跨站来源、伪造 Host、无会话请求和任意转发被拒绝', async t => {
  const f = await fixture(t)
  for (const headers of [{ origin: 'https://example.com' }, { host: 'example.com' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    // fetch 会重建 Host；用原生 HTTP 客户端才能实际发送伪造的 Host。
    const status = await new Promise((resolve, reject) => get(`${f.origin}/local/d3/session`, { headers }, response => {
      response.resume()
      response.once('end', () => resolve(response.statusCode))
    }).on('error', reject))
    assert.equal(status, 403, JSON.stringify(headers))
  }
  assert.equal((await f.request('public', 'GET', '/health', undefined, { 'x-d3-local-key': '' })).status, 403)
  assert.equal((await f.request('public', 'GET', '/health', undefined, { 'x-d3-local-key': 'wrong' })).status, 403)
  for (const [actor, method, path] of [['public', 'DELETE', '/announcements/1'], ['public', 'GET', '/../../api/d1/users/me'], ['__proto__', 'GET', '/health'], ['public', '__proto__', '/health'], ['public', 'GET', '/health#fragment']]) {
    assert.equal((await f.request(actor, method, path)).status, 400)
  }
  const forbidden = await fetch(`${f.origin}/local/d3/request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-d3-local-key': f.session.session_key },
    body: JSON.stringify({ actor: 'public', method: 'GET', path: 'http://example.com/api/d3/health' }) })
  assert.equal(forbidden.status, 400)
  const response = await f.request('public', 'GET', '/health')
  assert.equal(response.status, 200)
  assert.equal(response.data.storage, 'memory')
})

test('验收转发保留通知去重、来源隔离、本人消息、已读时间和失效规则', async t => {
  const f = await fixture(t)
  const event = { source_event_id: randomUUID(), notification_type: 'BOOKING_REMINDER', biz_type: 'SEAT_BOOKING', biz_id: '501',
    recipient_user_ids: ['101'], title: '页面验收测试', content: '<img src=x onerror=alert(1)>', occurred_at: new Date().toISOString() }
  const first = await f.request('M1', 'POST', '/internal/notifications', event)
  assert.equal(first.status, 201)
  const retry = await f.request('M1', 'POST', '/internal/notifications', event)
  assert.equal(retry.status, 200)
  assert.equal(retry.data.id, first.data.id)
  assert.equal(retry.data.deduplicated, true)
  assert.equal((await f.request('student-101', 'POST', '/internal/notifications', event)).status, 401)
  const inbox = await f.request('student-101', 'GET', '/messages/me')
  assert.equal(inbox.data.total, 1)
  assert.equal((await f.request('student-102', 'GET', '/messages/me')).data.total, 0)
  const id = inbox.data.items[0].id
  assert.equal((await f.request('student-102', 'POST', `/messages/me/${id}/read`, {})).status, 404)
  const read = await f.request('student-101', 'POST', `/messages/me/${id}/read`, {})
  assert.equal((await f.request('student-101', 'POST', `/messages/me/${id}/read`, {})).data.read_at, read.data.read_at)
  assert.equal((await f.request('M2', 'POST', `/internal/notifications/${first.data.id}/invalidate`, {})).status, 404)
  assert.equal((await f.request('M1', 'POST', `/internal/notifications/${first.data.id}/invalidate`, {})).status, 200)
  const history = await f.request('student-101', 'GET', '/messages/me')
  assert.equal(history.data.total, 1)
  assert.equal(history.data.items[0].is_active, false)
})

test('验收转发保留公告版本、公共可见性、权限拒绝和审计筛选', async t => {
  const f = await fixture(t)
  const body = { title: '公告验收', content: '仅供测试', type: 'NOTICE' }
  assert.equal((await f.request('student-101', 'POST', '/announcements', body)).status, 403)
  let current = (await f.request('operator-103', 'POST', '/announcements', body)).data
  assert.equal((await f.request('public', 'GET', '/announcements')).data.total, 0)
  current = (await f.request('operator-103', 'PATCH', `/announcements/${current.id}`, { content: '修改内容', expected_version: current.version })).data
  assert.equal((await f.request('operator-103', 'POST', `/announcements/${current.id}/publish`, { expected_version: 1 })).status, 409)
  current = (await f.request('operator-103', 'POST', `/announcements/${current.id}/publish`, { expected_version: current.version })).data
  assert.equal((await f.request('public', 'GET', '/announcements')).data.total, 1)
  assert.equal((await f.request('operator-103', 'PATCH', `/announcements/${current.id}`, { title: '非法修改', expected_version: current.version })).status, 409)
  current = (await f.request('operator-103', 'POST', `/announcements/${current.id}/withdraw`, { expected_version: current.version })).data
  assert.equal(current.status, 'WITHDRAWN')
  assert.equal((await f.request('public', 'GET', '/announcements')).data.total, 0)
  assert.equal((await f.request('student-101', 'GET', '/admin/logs')).status, 403)
  const logs = await f.request('admin-104', 'GET', '/admin/logs?user_id=101&result=DENIED')
  assert.equal(logs.status, 200)
  assert.ok(logs.data.total >= 2)
  assert.ok(logs.data.items.every(item => item.user_id === '101' && item.result === 'DENIED'))
})

test('数据库摘要错误不泄露连接信息，正式业务应用不提供验收入口', async t => {
  const f = await fixture(t)
  const response = await fetch(`${f.origin}/local/d3/database`, { headers: { 'x-d3-local-key': f.session.session_key } })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'DEPENDENCY_UNAVAILABLE')
  const app = createApp({ store: new MemoryStore(), authenticateUser: mockAuthenticate, serviceTokens: mockServiceTokens })
  const standard = await fixture(t, app)
  assert.equal((await fetch(`${standard.origin}/local/d3/`)).status, 404)
  assert.equal((await fetch(`${standard.origin}/local/d3/session`)).status, 404)
})

test('验收工具拒绝团队数据库配置', () => {
  for (const patch of [{ host: '0.0.0.0' }, { database: { ...config.database, host: 'team.example' } },
    { database: { ...config.database, database: 'campus_d3' } }, { database: { ...config.database, user: 'root' } }]) {
    assert.throws(() => createLocalApp({ store: new MemoryStore(), config: { ...config, ...patch } }))
  }
})
