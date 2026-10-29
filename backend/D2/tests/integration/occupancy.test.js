import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { createApp } from '../../src/app.js'
import { createPool } from '../../src/db.js'
import { createD1Client } from '../../src/dependencies.js'
import { expireBatch, startExpiryWorker } from '../../src/expiry.js'
import { migrate } from '../../scripts/migrate.js'

if (process.env.D2_TEST_ISOLATED !== 'docker' || !/^d2_test_[a-f0-9]{12}$/.test(process.env.D2_TEST_DB_NAME || '')) {
  throw new Error('请使用 npm run test:integration 启动独立临时 MySQL')
}
const db = { host: process.env.D2_TEST_DB_HOST, port: Number(process.env.D2_TEST_DB_PORT), database: process.env.D2_TEST_DB_NAME,
  user: process.env.D2_TEST_DB_USER, password: process.env.D2_TEST_DB_PASSWORD }
const keys = Object.fromEntries(['M1', 'M2', 'M3'].map(module => [module, randomBytes(32).toString('hex')]))
const users = {
  admin: { id: '1', roles: ['SYSTEM_ADMIN'], college_id: null, status: 'ACTIVE' },
  college: { id: '2', roles: ['CLASSROOM_ADMIN'], permissions: ['resource:manage'], college_id: '1', status: 'ACTIVE' },
  other: { id: '3', roles: ['CLASSROOM_ADMIN'], permissions: ['resource:manage'], college_id: '2', status: 'ACTIVE' },
  student: { id: '4', roles: ['STUDENT'], college_id: '1', status: 'ACTIVE' }
}
let pool, api, dependency, base, dependencyDown = false, sequence = 1000
const nextId = () => String(++sequence)
const interval = { start_time: '2035-01-01T09:00:00+08:00', end_time: '2035-01-01T10:00:00+08:00' }
const reports = []
async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
async function close(server) { if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
async function request(path, { method = 'GET', body, token = 'student', raw, headers = {} } = {}) {
  const response = await fetch(base + '/api/d2' + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${keys[token] || token}` } : {}),
      ...((body !== undefined || raw !== undefined) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) })
  const payload = await response.json()
  assert.deepEqual(Object.keys(payload).sort(), ['code', 'data', 'message', 'request_id'])
  if (!response.ok) assert.equal(payload.data, null)
  return { status: response.status, ...payload }
}
const post = (path, body, token = 'M1') => request(path, { method: 'POST', body, token })
async function resources(changes = {}) {
  const result = await post('/classrooms', { building: '测试楼', room_number: nextId(), capacity: 30, college_id: '1',
    is_bookable_whole: true, open_time: '08:00:00', close_time: '22:00:00', ...changes }, 'admin')
  assert.equal(result.status, 201, JSON.stringify(result))
  const room = result.data
  const seats = []
  for (const number of ['A', 'B']) {
    const seat = await post('/seats', { classroom_id: room.id, seat_number: number, socket_type: 'FIXED' }, 'admin')
    assert.equal(seat.status, 201); seats.push(seat.data)
  }
  return { room, seats }
}
function input(resource, whole = false, changes = {}) {
  return { resource_type: whole ? 'CLASSROOM' : 'SEAT', resource_id: resource.id,
    source_module: whole ? 'M2' : 'M1', source_id: nextId(), ...interval, ...changes }
}
async function hold(resource, whole = false, changes = {}) {
  const body = input(resource, whole, changes)
  const result = await post('/reservations', body, whole ? 'M2' : 'M1')
  assert.equal(result.status, 201, JSON.stringify(result))
  return { ...result.data, body }
}
const transition = (record, mode, token = record.source_module) => post(`/reservations/${record.id}/${mode}`, undefined, token)
const check = (resource, whole = false, changes = {}, token = 'student') => post('/availability/check',
  { resource_type: whole ? 'CLASSROOM' : 'SEAT', resource_id: resource.id, ...interval, ...changes }, token)
const sync = (room, ticket, active, revision, token = 'M3') => post('/internal/maintenance/sync',
  { classroom_id: room.id, ticket_id: ticket, active, revision }, token)
async function expire(record) {
  // 仅构造独立测试库中的过期夹具，避免测试依赖主机时钟或长时间等待。
  await pool.query('UPDATE resource_reservations SET hold_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)) WHERE id = ?', [record.id])
}

before(async () => {
  await migrate(db, () => {})
  pool = createPool(db)
  dependency = http.createServer((req, res) => {
    const identity = users[req.headers.authorization?.slice(7)]
    const data = req.url === '/api/d1/colleges' ? [{ id: '1', name: '学院一' }, { id: '2', name: '学院二' }] : identity
    res.writeHead(dependencyDown ? 503 : data ? 200 : 401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: dependencyDown ? 'DEPENDENCY_UNAVAILABLE' : data ? 'OK' : 'UNAUTHORIZED', data: data || null }))
  })
  const dependencyUrl = await listen(dependency)
  api = http.createServer(createApp({ pool, d1: createD1Client({ baseUrl: dependencyUrl, timeoutMs: 100 }), serviceTokens: keys,
    report: value => reports.push(value) }))
  base = await listen(api)
})
after(async () => { await close(api); await close(dependency); if (pool) await pool.end() })

test('D2-03/04/05/07/08：可用性、座位冲突、不同座位及半开相邻时段', async () => {
  const { room, seats } = await resources()
  assert.deepEqual((await check(seats[0])).data, { resource_type: 'SEAT', resource_id: seats[0].id,
    classroom_id: room.id, available: true, reason: null })
  const reservation = await hold(seats[0])
  assert.equal(reservation.status, 'HELD')
  assert.match(reservation.start_time, /Z$/)
  assert.equal(typeof reservation.id, 'string')
  assert.equal((await check(seats[0])).data.reason, 'RESOURCE_CONFLICT')
  assert.equal((await post('/reservations', input(seats[0]))).status, 409)
  await hold(seats[1])
  await hold(seats[0], false, { start_time: interval.end_time, end_time: '2035-01-01T11:00:00+08:00' })
  const found = await post('/availability/search', { resource_type: 'SEAT', ...interval, filters: { classroom_id: room.id, socket_type: 'FIXED' } }, 'M2')
  assert.deepEqual(found.data.map(item => item.resource_id), seats.map(seat => seat.id))
  assert.ok(found.data.every(item => !item.available))
  assert.equal((await post('/availability/search', { resource_type: 'CLASSROOM', ...interval,
    filters: { room_number: room.room_number, min_capacity: 30, is_bookable_whole: true, college_id: '1' } })).data.length, 1)
})

test('D2-06/11：座位和整教室双向冲突与并发互斥', async () => {
  const a = await resources()
  await hold(a.seats[0])
  assert.equal((await post('/reservations', input(a.room, true), 'M2')).code, 'RESOURCE_CONFLICT')
  const b = await resources()
  await hold(b.room, true)
  assert.equal((await post('/reservations', input(b.seats[0]))).code, 'RESOURCE_CONFLICT')
  const c = await resources()
  const results = await Promise.all(Array.from({ length: 12 }, () => post('/reservations', input(c.seats[0]))))
  assert.equal(results.filter(result => result.status === 201).length, 1)
  assert.ok(results.every(result => [201, 409].includes(result.status)), JSON.stringify(results))
  for (let i = 0; i < 3; i++) {
    const d = await resources()
    const race = await Promise.all([post('/reservations', input(d.seats[0])), post('/reservations', input(d.room, true), 'M2')])
    assert.deepEqual(race.map(result => result.status).sort(), [201, 409])
  }
})

test('D2-09/10/18：来源幂等、默认租约、确认/释放和终态重试', async () => {
  const { seats } = await resources()
  const body = input(seats[0])
  const result = await Promise.all(Array.from({ length: 8 }, () => post('/reservations', body)))
  assert.equal(result.filter(item => item.status === 201).length, 1)
  assert.equal(new Set(result.map(item => item.data.id)).size, 1)
  const record = result[0].data
  assert.ok(result.every(item => item.data.hold_expires_at === record.hold_expires_at))
  const [[lease]] = await pool.query('SELECT TIMESTAMPDIFF(SECOND, created_at, hold_expires_at) AS duration FROM resource_reservations WHERE id = ?', [record.id])
  assert.ok(lease.duration >= 299 && lease.duration <= 301)
  assert.equal((await post('/reservations', { ...body, resource_id: seats[1].id })).code, 'DUPLICATE_OPERATION')
  assert.equal((await post('/reservations', { ...body, hold_expires_at: record.hold_expires_at })).status, 200)
  assert.equal((await post('/reservations', { ...body, hold_expires_at: '2090-01-01T00:00:00Z' })).code, 'DUPLICATE_OPERATION')
  assert.equal((await transition(record, 'confirm')).data.status, 'CONFIRMED')
  assert.equal((await transition(record, 'confirm')).data.hold_expires_at, null)
  assert.equal((await post('/reservations', body)).data.status, 'CONFIRMED')
  assert.equal((await post(`/reservations/${record.id}/release`, { reason: '源业务取消' })).data.status, 'RELEASED')
  assert.equal((await transition(record, 'release')).status, 200)
  assert.equal((await transition(record, 'confirm')).code, 'INVALID_STATE')
  assert.equal((await post('/reservations', body)).data.status, 'RELEASED')
  assert.equal((await check(seats[0])).data.available, true)
  await hold(seats[0])
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM resource_reservations WHERE source_module = ? AND source_id = ?', ['M1', body.source_id])
  assert.equal(Number(count.n), 1)
})

test('D2-18：不同教室争抢同一来源键只生成一条，参数冲突可重试后返回 409', async () => {
  const a = await resources(), b = await resources()
  const source_id = nextId()
  const results = await Promise.all([post('/reservations', input(a.seats[0], false, { source_id })),
    post('/reservations', input(b.seats[0], false, { source_id }))])
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409])
  assert.equal(results.find(result => result.status === 409).code, 'DUPLICATE_OPERATION')
})

test('D2-14：过期记录逻辑释放、列表筛选、过期确认提交释放、相同资源可重新占用', async () => {
  const { seats } = await resources()
  const record = await hold(seats[0])
  await expire(record)
  assert.equal((await request(`/reservations/${record.id}`, { token: 'M1' })).data.status, 'RELEASED')
  assert.equal((await request(`/reservations?status=HELD&source_id=${record.source_id}`, { token: 'M1' })).data.total, 0)
  assert.equal((await request(`/reservations?status=RELEASED&source_id=${record.source_id}`, { token: 'M1' })).data.total, 1)
  assert.equal((await check(seats[0])).data.available, true)
  await hold(seats[0])
  assert.equal((await transition(record, 'confirm')).code, 'INVALID_STATE')
  const [[persisted]] = await pool.query('SELECT status FROM resource_reservations WHERE id = ?', [record.id])
  assert.equal(persisted.status, 'RELEASED')
  assert.equal((await post('/reservations', input(seats[1], false, { hold_expires_at: '2000-01-01T00:00:00Z' }))).status, 422)
})

test('D2-14/17：真实截止时间与后台 worker，停止、重启和竞争只释放/审计一次', async () => {
  const { seats } = await resources()
  const [[clock]] = await pool.query("SELECT DATE_FORMAT(TIMESTAMPADD(SECOND, 1, UTC_TIMESTAMP(3)), '%Y-%m-%dT%H:%i:%s.%fZ') AS deadline")
  const record = await hold(seats[0], false, { hold_expires_at: clock.deadline.replace(/(\.\d{3})\d{3}Z$/, '$1Z') })
  await pause(1100)
  const outcomes = await Promise.all([expireBatch(pool), expireBatch(pool), transition(record, 'confirm')])
  assert.equal(outcomes[2].status, 409)
  const [[logs]] = await pool.query("SELECT COUNT(*) AS n FROM operation_log_outbox WHERE payload->>'$.action' = 'RESERVATION_EXPIRE' AND payload->>'$.target_id' = ?", [record.id])
  assert.equal(Number(logs.n), 1)
  const second = await hold(seats[1])
  let stop = startExpiryWorker({ pool, pollMs: 20 })
  await stop()
  await expire(second)
  await pause(50)
  assert.equal((await pool.query('SELECT status FROM resource_reservations WHERE id = ?', [second.id]))[0][0].status, 'HELD')
  stop = startExpiryWorker({ pool, pollMs: 20 })
  try {
    for (let i = 0; i < 50; i++) {
      if ((await pool.query('SELECT status FROM resource_reservations WHERE id = ?', [second.id]))[0][0].status === 'RELEASED') break
      await pause(20)
    }
  } finally { await stop() }
  assert.equal((await pool.query('SELECT status FROM resource_reservations WHERE id = ?', [second.id]))[0][0].status, 'RELEASED')
})

test('D2-17：确认与释放并发，最终不可复活', async () => {
  const { seats } = await resources()
  const record = await hold(seats[0])
  const results = await Promise.all([transition(record, 'confirm'), transition(record, 'release'), transition(record, 'confirm')])
  assert.ok(results.every(result => [200, 409].includes(result.status)))
  assert.equal((await request(`/reservations/${record.id}`, { token: 'M1' })).data.status, 'RELEASED')
  assert.equal((await transition(record, 'confirm')).status, 409)
})

test('D2-12/15/16：多工单并集、乱序幂等、返工、工单教室固定并保留原占用', async () => {
  const { room, seats } = await resources(), other = await resources()
  const record = await hold(seats[0])
  await transition(record, 'confirm')
  const t1 = nextId(), t2 = nextId()
  assert.equal((await sync(room, t1, true, 1)).data.maintenance_blocked, true)
  assert.equal((await sync(room, t2, true, 1)).status, 200)
  assert.equal((await check(seats[1])).data.reason, 'CLASSROOM_MAINTENANCE')
  assert.equal((await post('/reservations', input(seats[1]))).status, 409)
  assert.equal((await sync(room, t1, false, 2)).data.maintenance_blocked, true)
  assert.equal((await sync(room, t2, false, 2)).data.maintenance_blocked, false)
  assert.equal((await sync(room, t1, true, 1)).data.maintenance_blocked, false)
  assert.equal((await sync(room, t1, false, 2)).status, 200)
  assert.equal((await sync(room, t1, true, 2)).code, 'INVALID_STATE')
  assert.equal((await sync(other.room, t1, false, 1)).status, 409)
  assert.equal((await sync(room, t1, true, 3)).data.maintenance_blocked, true)
  await request(`/classrooms/${room.id}`, { method: 'PATCH', token: 'admin', body: { status: 'AVAILABLE' } })
  assert.equal((await check(seats[1])).data.reason, 'CLASSROOM_MAINTENANCE')
  assert.equal((await request(`/reservations/${record.id}`, { token: 'M1' })).data.status, 'CONFIRMED')
  await request(`/classrooms/${room.id}`, { method: 'PATCH', token: 'admin', body: { status: 'MAINTENANCE' } })
  assert.equal((await sync(room, t1, false, 4)).data.maintenance_blocked, true)
  await request(`/classrooms/${room.id}`, { method: 'PATCH', token: 'admin', body: { status: 'DISABLED' } })
  assert.equal((await check(seats[1])).data.reason, 'CLASSROOM_DISABLED')
})

test('维修与预占竞争服从同一教室锁；确认复核维修/停用状态', async () => {
  const { room, seats } = await resources()
  const record = await hold(seats[0])
  await sync(room, nextId(), true, 1)
  assert.equal((await transition(record, 'confirm')).code, 'RESOURCE_CONFLICT')
  assert.equal((await transition(record, 'release')).status, 200)
  const second = await resources()
  const outcomes = await Promise.all([post('/reservations', input(second.seats[0])), sync(second.room, nextId(), true, 1)])
  assert.ok([201, 409].includes(outcomes[0].status))
  assert.equal(outcomes[1].status, 200)
  assert.equal((await post('/reservations', input(second.seats[1]))).status, 409)
})

test('锁等待后读取最新已提交冲突，不能沿用解析座位时的旧快照', async () => {
  const { room, seats } = await resources()
  const blocker = await pool.getConnection()
  let pending
  try {
    await blocker.beginTransaction()
    await blocker.query('SELECT id FROM classrooms WHERE id = ? FOR UPDATE', [room.id])
    pending = post('/reservations', input(seats[0]))
    await pause(100)
    await blocker.query(`INSERT INTO resource_reservations
      (resource_type, resource_id, classroom_id, source_module, source_id, start_time, end_time, status, hold_expires_at)
      VALUES ('CLASSROOM', ?, ?, 'M2', ?, '2035-01-01 01:00:00', '2035-01-01 02:00:00', 'CONFIRMED', NULL)`,
    [room.id, room.id, nextId()])
    await blocker.commit()
    const result = await pending
    assert.equal(result.status, 409)
    assert.equal(result.code, 'RESOURCE_CONFLICT')
  } finally { await blocker.rollback(); blocker.release(); if (pending) await pending }
})

test('D2-12/19：禁用、座位维修、不允许整间、开放窗口及关闭端点', async () => {
  const { room, seats } = await resources({ is_bookable_whole: false })
  assert.equal((await check(room, true)).data.reason, 'WHOLE_BOOKING_NOT_ALLOWED')
  for (const status of ['DISABLED', 'MAINTENANCE']) {
    await request(`/seats/${seats[0].id}`, { method: 'PATCH', token: 'admin', body: { status } })
    assert.equal((await check(seats[0])).data.reason, `SEAT_${status}`)
    assert.equal((await post('/reservations', input(seats[0]))).status, 409)
  }
  const overnight = await resources({ open_time: '22:00:00', close_time: '06:00:00' })
  assert.equal((await check(overnight.seats[0])).data.reason, 'OUTSIDE_OPENING_HOURS')
  await hold(overnight.seats[0], false, { start_time: '2035-01-01T23:00:00+08:00', end_time: '2035-01-02T06:00:00+08:00' })
  assert.equal((await check(overnight.seats[1], false, { start_time: '2035-01-02T05:00:00+08:00', end_time: '2035-01-02T06:00:00.001+08:00' })).data.reason, 'OUTSIDE_OPENING_HOURS')
  const allDay = await resources({ open_time: '00:00:00', close_time: '00:00:00' })
  await hold(allDay.room, true, { start_time: '2035-01-01T00:00:00Z', end_time: '2035-01-03T00:00:00Z' })
})

test('D2-20：服务隔离、用户/管理员只读范围、可信身份和 D1 故障边界', async () => {
  const { room, seats } = await resources()
  const record = await hold(seats[0])
  assert.equal((await post('/reservations', input(seats[1]), 'M2')).status, 403)
  assert.equal((await post('/reservations', input(room, true), 'M1')).status, 403)
  for (const token of ['student', 'admin', 'M3']) assert.equal((await post('/reservations', input(seats[1]), token)).status, 403)
  for (const token of ['student', 'admin', 'M1', 'M2']) assert.equal((await sync(room, nextId(), true, 1, token)).status, 403)
  for (const token of ['student', 'M2', 'M3', 'other']) assert.equal((await request(`/reservations/${record.id}`, { token })).status, 403)
  for (const token of ['admin', 'college', 'M1']) assert.equal((await request(`/reservations/${record.id}`, { token })).status, 200)
  for (const token of ['student', 'admin', 'M2', 'M3']) assert.equal((await transition(record, 'release', token)).status, 403)
  assert.equal((await request(`/reservations?source_id=${record.source_id}`, { token: 'other' })).data.total, 0)
  assert.equal((await request(`/reservations?source_id=${record.source_id}`, { token: 'college' })).data.total, 1)
  assert.equal((await request('/reservations?source_module=M1', { token: 'M2' })).data.total, 0)
  assert.equal((await request('/classrooms', { token: 'M3' })).status, 403)
  assert.equal((await check(seats[0], false, {}, 'M3')).status, 403)
  assert.equal((await post('/classrooms', {}, 'M1')).status, 403)
  try {
    dependencyDown = true
    assert.equal((await check(seats[1])).status, 503)
    assert.equal((await check(seats[1], false, {}, 'M1')).status, 200)
    assert.equal((await request('/reservations', { token: 'invalid', headers: { 'X-Roles': 'SYSTEM_ADMIN' } })).status, 503)
  } finally { dependencyDown = false }
})

test('所有新增接口：无认证、缺字段、非法字段/状态、重复参数、未知资源', async () => {
  const { room, seats } = await resources()
  const record = await hold(seats[0])
  const routes = [
    ['/availability/search', 'POST', { resource_type: 'SEAT', ...interval }, 'student'],
    ['/availability/check', 'POST', { resource_type: 'SEAT', resource_id: seats[0].id, ...interval }, 'student'],
    ['/reservations', 'POST', input(seats[1]), 'M1'],
    [`/reservations/${record.id}/confirm`, 'POST', undefined, 'M1'],
    [`/reservations/${record.id}/release`, 'POST', undefined, 'M1'],
    ['/reservations', 'GET', undefined, 'M1'], [`/reservations/${record.id}`, 'GET', undefined, 'M1'],
    ['/internal/maintenance/sync', 'POST', { ticket_id: nextId(), classroom_id: room.id, active: true, revision: 1 }, 'M3']
  ]
  for (const [path, method, body] of routes) assert.equal((await request(path, { method, body, token: null })).status, 401)
  for (const [path, method, body, token] of routes) {
    if (body) for (const key of Object.keys(body)) {
      const missing = { ...body }; delete missing[key]
      assert.equal((await request(path, { method, body: missing, token })).status, 400, `${path} missing ${key}`)
    }
  }
  for (const [path, body, token] of [
    ['/availability/search', { resource_type: 'SEAT', ...interval, filters: { min_capacity: 1 } }, 'M1'],
    ['/availability/check', { resource_type: 'SEAT', resource_id: seats[0].id, ...interval, user_id: '1' }, 'student'],
    ['/reservations', { ...input(seats[1]), hold_expires_at: null }, 'M1'],
    [`/reservations/${record.id}/confirm`, { status: 'CONFIRMED' }, 'M1'],
    [`/reservations/${record.id}/release`, { reason: '' }, 'M1'],
    ['/internal/maintenance/sync', { ticket_id: nextId(), classroom_id: room.id, active: 'true', revision: 1 }, 'M3']
  ]) assert.equal((await post(path, body, token)).status, 400)
  for (const query of ['status=EXPIRED', 'page_size=101', 'source_id=1&source_id=2']) assert.equal((await request('/reservations?' + query, { token: 'M1' })).status, 400)
  for (const mode of ['confirm', 'release']) assert.equal((await post(`/reservations/99999999/${mode}`, undefined)).status, 404)
  assert.equal((await request('/reservations/99999999', { token: 'M1' })).status, 404)
  assert.equal((await check({ id: '99999999' })).status, 404)
  assert.equal((await post('/reservations', input({ id: '99999999' }))).status, 404)
  assert.equal((await sync({ id: '99999999' }, nextId(), true, 1)).status, 404)
  assert.equal((await post('/reservations', undefined)).status, 400)
  assert.equal((await request('/internal/maintenance/sync', { method: 'POST', raw: '{bad', token: 'M3' })).status, 400)
})

test('占用和维修 outbox 故障事务回滚，BIGINT 响应无精度丢失，审计不包含秘密', async () => {
  const { room, seats } = await resources()
  const record = await hold(seats[0])
  const ticket = nextId()
  await pool.query('RENAME TABLE operation_log_outbox TO operation_log_outbox_test_backup')
  try {
    assert.equal((await post('/reservations', input(seats[1]))).status, 503)
    assert.equal((await transition(record, 'confirm')).status, 503)
    assert.equal((await sync(room, ticket, true, 1)).status, 503)
    assert.equal((await pool.query('SELECT status FROM resource_reservations WHERE id = ?', [record.id]))[0][0].status, 'HELD')
    assert.equal((await pool.query('SELECT ticket_id FROM maintenance_blocks WHERE ticket_id = ?', [ticket]))[0].length, 0)
    assert.equal((await pool.query('SELECT id FROM resource_reservations WHERE resource_id = ?', [seats[1].id]))[0].length, 0)
  } finally { await pool.query('RENAME TABLE operation_log_outbox_test_backup TO operation_log_outbox') }
  await pool.query('ALTER TABLE resource_reservations AUTO_INCREMENT = 9007199254740993')
  const large = await hold(seats[1], false, { source_id: '9223372036854775807' })
  assert.equal(large.id, '9007199254740993')
  assert.equal((await request(`/reservations/${large.id}`, { token: 'M1' })).data.source_id, '9223372036854775807')
  const [rows] = await pool.query('SELECT payload FROM operation_log_outbox')
  for (const row of rows) {
    const value = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    assert.deepEqual(Object.keys(value).sort(), ['user_id', 'module', 'action', 'target_type', 'target_id', 'request_method', 'request_path', 'result', 'ip_address'].sort())
    assert.ok(!Object.values(keys).some(key => JSON.stringify(value).includes(key)))
    assert.ok(!JSON.stringify(value).includes('源业务取消'))
    if (value.request_method === 'SYSTEM') { assert.equal(value.user_id, null); assert.equal(value.ip_address, null) }
  }
  assert.ok(!Object.values(keys).some(key => reports.some(value => value.includes(key))))
})
