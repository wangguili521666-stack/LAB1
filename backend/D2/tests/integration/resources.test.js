import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { setTimeout as pause } from 'node:timers/promises'
import { createApp } from '../../src/app.js'
import { createPool } from '../../src/db.js'
import { createD1Client, createD3Sender } from '../../src/dependencies.js'
import { deliverOne, enqueueAudit, startAuditWorker } from '../../src/audit.js'
import { migrate } from '../../scripts/migrate.js'

// 不允许误指向开发库或共享库。环境只由独立 Docker 测试脚本提供。
if (process.env.D2_TEST_ISOLATED !== 'docker' || !/^d2_test_[a-f0-9]{12}$/.test(process.env.D2_TEST_DB_NAME || '')) {
  throw new Error('请使用 npm run test:integration 启动独立临时 MySQL')
}
const db = {
  host: process.env.D2_TEST_DB_HOST, port: Number(process.env.D2_TEST_DB_PORT),
  database: process.env.D2_TEST_DB_NAME, user: process.env.D2_TEST_DB_USER, password: process.env.D2_TEST_DB_PASSWORD
}
let pool, api, dependencies, baseUrl, dependencyUrl
let ownRoom, otherRoom, publicRoom, ownSeat
let identityMode = 'normal'
let collegeMode = 'normal'
let auditMode = 'normal'
const delivered = []
const reports = []
const users = {
  student: { id: '101', roles: ['STUDENT'], college_id: '1', status: 'ACTIVE' },
  sysadmin: { id: '102', roles: ['SYSTEM_ADMIN'], college_id: null, status: 'ACTIVE' },
  own: { id: '103', roles: ['CLASSROOM_ADMIN'], permissions: ['resource:manage'], college_id: '1', status: 'ACTIVE' },
  other: { id: '104', roles: ['CLASSROOM_ADMIN'], permissions: ['resource:manage'], college_id: '2', status: 'ACTIVE' },
  unassigned: { id: '105', roles: ['CLASSROOM_ADMIN'], permissions: ['resource:manage'], college_id: null, status: 'ACTIVE' },
  disabled: { id: '106', roles: ['SYSTEM_ADMIN'], college_id: null, status: 'DISABLED' }
}
const roomBody = changes => ({ building: '教学楼A', room_number: '301', capacity: 30, is_bookable_whole: true,
  open_time: '08:00:00', close_time: '22:00:00', ...changes })

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
async function close(server) {
  if (!server) return
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
}
async function request(path, { method = 'GET', body, token = 'student', raw, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((body !== undefined || raw !== undefined) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await response.json()
  assert.deepEqual(Object.keys(data).sort(), ['code', 'data', 'message', 'request_id'])
  assert.match(data.request_id, /^[a-f0-9-]{36}$/)
  if (!response.ok) assert.equal(data.data, null)
  return { status: response.status, ...data }
}
async function createRoom(changes = {}, token = 'sysadmin') {
  const result = await request('/api/d2/classrooms', { method: 'POST', token, body: roomBody(changes) })
  assert.equal(result.status, 201, JSON.stringify(result))
  return result.data
}

before(async () => {
  await migrate(db, () => {})
  pool = createPool(db)
  dependencies = http.createServer(async (req, res) => {
    const token = req.headers.authorization?.slice(7)
    const reply = (status, data, code = status < 400 ? 'OK' : 'ERROR') => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code, message: 'test', data, request_id: 'test-dependency' }))
    }
    if (req.url === '/api/d1/users/me') {
      if (identityMode === 'down') return reply(503, null)
      if (identityMode === 'malformed') return reply(200, { id: 1 })
      if (identityMode === 'slow') await pause(250)
      return users[token] ? reply(200, users[token]) : reply(401, null)
    }
    if (req.url === '/api/d1/colleges') {
      assert.ok(users[token], '学院查询必须使用真实用户上下文')
      if (collegeMode === 'missing') return reply(404, null)
      if (collegeMode === 'down') return reply(503, null)
      if (collegeMode === 'malformed') return reply(200, {})
      return reply(200, [{ id: '1', name: '学院一' }, { id: '2', name: '学院二' }])
    }
    if (req.url === '/api/d3/internal/logs') {
      assert.equal(req.method, 'POST')
      assert.equal(req.headers['x-d3-service-token'], 'isolated-test-service-token')
      let body = ''
      for await (const chunk of req) body += chunk
      if (auditMode === 'down') return reply(503, null)
      delivered.push(JSON.parse(body))
      return reply(201, { id: String(delivered.length) })
    }
    reply(404, null)
  })
  dependencyUrl = await listen(dependencies)
  const d1 = createD1Client({ baseUrl: dependencyUrl, timeoutMs: 100 })
  api = http.createServer(createApp({ pool, d1, report: message => reports.push(message) }))
  baseUrl = await listen(api)
  ownRoom = await createRoom({ college_id: '1' })
  otherRoom = await createRoom({ college_id: '2', room_number: '302' })
  publicRoom = await createRoom({ room_number: '303' })
  const result = await request('/api/d2/seats', { method: 'POST', token: 'own',
    body: { classroom_id: ownRoom.id, seat_number: 'A01', socket_type: 'FIXED' } })
  assert.equal(result.status, 201)
  ownSeat = result.data
})

after(async () => {
  await close(api)
  await close(dependencies)
  if (pool) await pool.end()
})

test('空库迁移可重放，并发迁移受锁保护，学院无跨库外键', async () => {
  await Promise.all([migrate(db, () => {}), migrate(db, () => {})])
  const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM schema_migrations')
  assert.equal(Number(row.count), 4)
  const [foreign] = await pool.query(`SELECT REFERENCED_TABLE_SCHEMA FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [db.database])
  assert.ok(foreign.every(row => row.REFERENCED_TABLE_SCHEMA === db.database))
  assert.equal((await request('/api/d2/health', { token: null })).status, 200)
})

test('D2-01/02：系统管理员新增教室，自习室管理员新增本学院座位，返回契约字段', async () => {
  assert.deepEqual(Object.keys(ownRoom).sort(), ['id', 'building', 'room_number', 'college_id', 'capacity', 'equipment',
    'status', 'is_bookable_whole', 'open_time', 'close_time'].sort())
  assert.deepEqual(Object.keys(ownSeat).sort(), ['id', 'classroom_id', 'seat_number', 'socket_type', 'status'].sort())
  assert.equal(ownRoom.status, 'AVAILABLE')
  assert.equal(publicRoom.college_id, null)
  assert.deepEqual(publicRoom.equipment, {})
  assert.equal(typeof ownRoom.is_bookable_whole, 'boolean')
  assert.equal(ownSeat.classroom_id, ownRoom.id)
  assert.equal((await request(`/api/d2/classrooms/${ownRoom.id}`)).data.id, ownRoom.id)
  assert.equal((await request(`/api/d2/seats/${ownSeat.id}`)).data.id, ownSeat.id)
})

test('所有主数据接口检查无认证；所有维护接口拒绝学生、伪造身份和禁用账号', async () => {
  const routes = [
    ['/api/d2/classrooms', 'GET'], [`/api/d2/classrooms/${ownRoom.id}`, 'GET'],
    [`/api/d2/classrooms/${ownRoom.id}/seats`, 'GET'], [`/api/d2/seats/${ownSeat.id}`, 'GET'],
    ['/api/d2/classrooms', 'POST', roomBody()], [`/api/d2/classrooms/${ownRoom.id}`, 'PATCH', { capacity: 31 }],
    ['/api/d2/seats', 'POST', { classroom_id: ownRoom.id, seat_number: 'B01', socket_type: 'NONE' }],
    [`/api/d2/seats/${ownSeat.id}`, 'PATCH', { status: 'DISABLED' }]
  ]
  for (const [path, method, body] of routes) {
    assert.equal((await request(path, { method, body, token: null })).status, 401)
    assert.equal((await request(path, { method, body, token: 'forged-token' })).status, 401)
    if (method !== 'GET') assert.equal((await request(path, { method, body })).status, 403)
  }
  assert.equal((await request('/api/d2/classrooms', { token: 'disabled' })).status, 403)
  assert.equal((await request('/api/d2/classrooms', { method: 'POST', token: 'sysadmin', body: { ...roomBody(), user_id: '999' } })).status, 400)
})

test('D2-13：学院边界、无学院管理员、公共资源、跨学院转移均在后端拒绝', async () => {
  assert.ok((await createRoom({ college_id: '1', room_number: '401' }, 'own')).id)
  for (const token of ['other', 'unassigned']) {
    assert.equal((await request(`/api/d2/classrooms/${ownRoom.id}`, { method: 'PATCH', token, body: { capacity: 31 } })).status, 403)
    assert.equal((await request(`/api/d2/seats/${ownSeat.id}`, { method: 'PATCH', token, body: { status: 'DISABLED' } })).status, 403)
    assert.equal((await request('/api/d2/seats', { method: 'POST', token, body: { classroom_id: ownRoom.id, seat_number: 'X', socket_type: 'NONE' } })).status, 403)
  }
  for (const college_id of [null, '2']) {
    assert.equal((await request(`/api/d2/classrooms/${ownRoom.id}`, { method: 'PATCH', token: 'own', body: { college_id } })).status, 403)
    assert.equal((await request('/api/d2/classrooms', { method: 'POST', token: 'own', body: roomBody({ college_id }) })).status, 403)
  }
  assert.equal((await request(`/api/d2/classrooms/${publicRoom.id}`, { method: 'PATCH', token: 'own', body: { capacity: 31 } })).status, 403)
})

test('查询支持筛选、稳定分页、空结果，SQL 注入字符串仅按字面匹配', async () => {
  const result = await request('/api/d2/classrooms?college_id=1&min_capacity=20&is_bookable_whole=true&page=1&page_size=1')
  assert.equal(result.status, 200)
  assert.equal(result.data.items.length, 1)
  assert.equal(result.data.page_size, 1)
  assert.ok(result.data.total >= 2)
  assert.equal((await request('/api/d2/classrooms?page=2147483647&page_size=100')).data.items.length, 0)
  assert.equal((await request(`/api/d2/classrooms?building=${encodeURIComponent("' OR 1=1 --")}`)).data.items.length, 0)
  const seats = await request(`/api/d2/classrooms/${ownRoom.id}/seats?socket_type=FIXED&status=AVAILABLE`)
  assert.equal(seats.status, 200)
  assert.equal(seats.data[0].id, ownSeat.id)
  for (const query of ['page=0', 'page_size=101', 'page=1&page=2', 'is_bookable_whole=1', 'user_id=1']) {
    assert.equal((await request(`/api/d2/classrooms?${query}`)).status, 400)
  }
})

test('缺字段、错误 JSON、非法枚举、禁止字段和空 PATCH 返回 400；资源不存在返回 404', async () => {
  for (const [path, method, body] of [
    ['/api/d2/classrooms', 'POST', {}], ['/api/d2/seats', 'POST', {}],
    [`/api/d2/classrooms/${ownRoom.id}`, 'PATCH', {}], [`/api/d2/classrooms/${ownRoom.id}`, 'PATCH', { status: 'DELETED' }],
    [`/api/d2/seats/${ownSeat.id}`, 'PATCH', {}], [`/api/d2/seats/${ownSeat.id}`, 'PATCH', { classroom_id: otherRoom.id }],
    ['/api/d2/seats', 'POST', { classroom_id: ownRoom.id, seat_number: 'X', socket_type: 'USB' }]
  ]) assert.equal((await request(path, { method, body, token: 'sysadmin' })).status, 400)
  assert.equal((await request('/api/d2/classrooms', { method: 'POST', raw: '{broken', token: 'sysadmin' })).status, 400)
  for (const path of ['/api/d2/classrooms/999999', '/api/d2/seats/999999', '/api/d2/classrooms/999999/seats']) {
    assert.equal((await request(path)).status, 404)
  }
  for (const [path, body] of [['/api/d2/classrooms/999999', { capacity: 1 }], ['/api/d2/seats/999999', { status: 'DISABLED' }]]) {
    assert.equal((await request(path, { method: 'PATCH', body, token: 'sysadmin' })).status, 404)
  }
  assert.equal((await request('/api/d2/seats', { method: 'POST', token: 'sysadmin',
    body: { classroom_id: '999999', seat_number: 'X', socket_type: 'NONE' } })).status, 404)
  assert.equal((await request('/api/d2/classrooms/9223372036854775808')).status, 400)
})

test('学院不存在返回 422；D1 学院接口未实现或异常时返回 503 且不写入', async () => {
  const [[before]] = await pool.query('SELECT COUNT(*) AS count FROM classrooms')
  assert.equal((await request('/api/d2/classrooms', { method: 'POST', token: 'sysadmin', body: roomBody({ college_id: '999' }) })).status, 422)
  try {
    for (const mode of ['missing', 'down', 'malformed']) {
      collegeMode = mode
      assert.equal((await request('/api/d2/classrooms', { method: 'POST', token: 'sysadmin', body: roomBody({ college_id: '1' }) })).status, 503)
    }
  } finally { collegeMode = 'normal' }
  const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM classrooms')
  assert.equal(after.count, before.count)
})

test('D1 不可用、返回异常或超时均返回 503，不信任客户端声明的角色', async () => {
  try {
    for (const mode of ['down', 'malformed', 'slow']) {
      identityMode = mode
      assert.equal((await request('/api/d2/classrooms', { headers: { 'X-User-Id': '102', 'X-Roles': 'SYSTEM_ADMIN' } })).status, 503)
    }
  } finally { identityMode = 'normal' }
})

test('重复 POST 创建独立记录；相同 PATCH 可重复调用；停用教室不覆盖座位自身状态', async () => {
  const first = await createRoom({ room_number: '重复编号' })
  const second = await createRoom({ room_number: '重复编号' })
  assert.notEqual(first.id, second.id)
  for (let i = 0; i < 2; i++) {
    const result = await request(`/api/d2/classrooms/${ownRoom.id}`, { method: 'PATCH', token: 'own', body: { status: 'DISABLED' } })
    assert.equal(result.status, 200)
    assert.equal(result.data.status, 'DISABLED')
  }
  assert.equal((await request(`/api/d2/seats/${ownSeat.id}`)).data.status, 'AVAILABLE')
  const result = await request(`/api/d2/seats/${ownSeat.id}`, { method: 'PATCH', token: 'own', body: { seat_number: 'A02', socket_type: 'RAIL' } })
  assert.equal(result.status, 200)
  assert.equal(result.data.socket_type, 'RAIL')
})

test('BIGINT 查询和新增 ID 超过 JS 安全整数后仍保持十进制字符串精度', async () => {
  const large = '9007199254740993'
  await pool.query(`INSERT INTO classrooms
    (id, building, room_number, capacity, equipment, is_bookable_whole, open_time, close_time)
    VALUES (?, '精度测试', '1', 10, '{}', 1, '08:00:00', '22:00:00')`, [large])
  assert.equal((await request(`/api/d2/classrooms/${large}`)).data.id, large)
  const created = await createRoom({ building: '精度测试', room_number: '2' })
  assert.equal(created.id, '9007199254740994')
})

test('座位维护等待教室锁，并按提交后的学院归属重新检查权限', async () => {
  const connection = await pool.getConnection()
  let pending
  try {
    await connection.beginTransaction()
    await connection.query('UPDATE classrooms SET college_id = ? WHERE id = ?', ['2', ownRoom.id])
    let settled = false
    pending = request(`/api/d2/seats/${ownSeat.id}`, { method: 'PATCH', token: 'own', body: { status: 'DISABLED' } })
      .then(value => { settled = true; return value })
    await pause(150)
    assert.equal(settled, false, '维护必须等待当前教室事务，不能使用旧学院快照完成写入')
    await connection.commit()
    assert.equal((await pending).status, 403)
    assert.equal((await request(`/api/d2/seats/${ownSeat.id}`)).data.status, 'AVAILABLE')
  } finally {
    await connection.rollback()
    connection.release()
    if (pending) await pending.catch(() => {})
    await pool.query('UPDATE classrooms SET college_id = ? WHERE id = ?', ['1', ownRoom.id])
  }
})

test('真实数据库注入审计写入故障时，资源变更与成功日志共同回滚', async () => {
  const [[before]] = await pool.query('SELECT COUNT(*) AS count FROM classrooms')
  // 仅在独立测试库中临时移走 outbox，注入真实 SQL 故障；不授予应用 SUPER 权限。
  await pool.query('RENAME TABLE operation_log_outbox TO operation_log_outbox_test_backup')
  try {
    const result = await request('/api/d2/classrooms', { method: 'POST', token: 'sysadmin', body: roomBody() })
    assert.equal(result.status, 503)
    const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM classrooms')
    assert.equal(after.count, before.count)
  } finally { await pool.query('RENAME TABLE operation_log_outbox_test_backup TO operation_log_outbox') }
})

test('成功和失败审计使用可信身份，不保存 Token、请求体、查询字符串或私有资料', async () => {
  const [rows] = await pool.query('SELECT payload FROM operation_log_outbox')
  const logs = rows.map(row => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)
  assert.ok(logs.some(log => log.user_id === '102' && log.result === 'SUCCESS'))
  assert.ok(logs.some(log => log.user_id === '101' && log.result === 'FAILURE'))
  assert.ok(logs.some(log => log.user_id === null && log.result === 'FAILURE'))
  for (const log of logs) {
    assert.deepEqual(Object.keys(log).sort(), ['user_id', 'module', 'action', 'target_type', 'target_id',
      'request_method', 'request_path', 'result', 'ip_address'].sort())
    assert.equal(log.module, 'D2')
    assert.equal(log.request_path.includes('?'), false)
    assert.equal(JSON.stringify(log).includes('Bearer'), false)
  }
  assert.ok(reports.every(message => !/Bearer|password|SELECT|INSERT/.test(message)))
})

test('D3 故障时日志持久化，重新创建连接后仍可重试，发送成功后不再投递', async () => {
  await pool.query("UPDATE operation_log_outbox SET status = 'SENT'")
  const payload = { user_id: '102', module: 'D2', action: 'CLASSROOM_CREATE', target_type: 'CLASSROOM',
    target_id: ownRoom.id, request_method: 'POST', request_path: '/api/d2/classrooms', result: 'SUCCESS', ip_address: '127.0.0.1' }
  await enqueueAudit(pool, payload)
  const send = createD3Sender({ baseUrl: dependencyUrl, token: 'isolated-test-service-token', timeoutMs: 100 })
  try {
    auditMode = 'down'
    assert.equal(await deliverOne(pool, send), true)
  } finally { auditMode = 'normal' }
  const [[pending]] = await pool.query("SELECT id, status, attempts FROM operation_log_outbox WHERE status = 'PENDING'")
  assert.equal(pending.attempts, 1)
  const reopened = createPool(db)
  try {
    await reopened.query('UPDATE operation_log_outbox SET next_attempt_at = UTC_TIMESTAMP() WHERE id = ?', [pending.id])
    const before = delivered.length
    await Promise.all([deliverOne(reopened, send), deliverOne(reopened, send)])
    assert.equal(delivered.length, before + 1)
    assert.deepEqual(delivered.at(-1), payload)
    assert.equal(await deliverOne(reopened, send), false)
    const [[sent]] = await reopened.query('SELECT status, attempts FROM operation_log_outbox WHERE id = ?', [pending.id])
    assert.equal(sent.status, 'SENT')
    assert.equal(sent.attempts, 2)
  } finally { await reopened.end() }
})

test('后台 worker 将已有 outbox 日志发送至 D3，停止时等待当前任务结束', async () => {
  await enqueueAudit(pool, { user_id: null, module: 'D2', action: 'SEAT_UPDATE', target_type: 'SEAT', target_id: ownSeat.id,
    request_method: 'PATCH', request_path: `/api/d2/seats/${ownSeat.id}`, result: 'FAILURE', ip_address: '127.0.0.1' })
  const before = delivered.length
  const stop = startAuditWorker({ pool, send: createD3Sender({ baseUrl: dependencyUrl, token: 'isolated-test-service-token', timeoutMs: 100 }),
    pollMs: 20, report: message => reports.push(message) })
  try {
    for (let i = 0; i < 50 && delivered.length === before; i++) await pause(20)
    assert.equal(delivered.length, before + 1)
  } finally { await stop() }
})
