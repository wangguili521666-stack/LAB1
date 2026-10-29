import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, test } from 'node:test'
import jwt from 'jsonwebtoken'
import { startStub } from './stub.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const START = '2026-12-01T09:00:00+08:00'
const END = '2026-12-01T11:00:00+08:00'
const TOKEN = 'test-internal-token'

let stub
let server
let base
let expireOverdue
let getPool
let closePool

function loadEnv() {
  const file = path.join(root, '.env')
  const text = fs.readFileSync(file, 'utf8')
  const values = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  if (!values.M2_DB_PASSWORD) throw new Error('根目录 .env 缺少 M2_DB_PASSWORD')
  process.env.DB_HOST = '127.0.0.1'
  process.env.DB_PORT = values.MYSQL_PORT || '3306'
  process.env.DB_NAME = 'campus_m2'
  process.env.DB_USER = 'm2_app'
  process.env.DB_PASSWORD = values.M2_DB_PASSWORD
  process.env.JWT_SECRET = 'test-m2-secret'
  process.env.INTERNAL_SERVICE_TOKEN = TOKEN
  process.env.M2_APPROVAL_TIMEOUT_HOURS = '24'
  process.env.M2_DISABLE_SCHEDULER = '1'
}

function userToken(id) {
  return jwt.sign({ sub: String(id), username: `user${id}` }, process.env.JWT_SECRET, { expiresIn: 3600 })
}

async function api(method, urlPath, { token, body } = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  return { status: response.status, json }
}

async function apply(token, classroomId = '201', start = START, end = END) {
  return api('POST', '/api/m2/applications', {
    token,
    body: { classroom_id: classroomId, purpose: '学术研讨', start_time: start, end_time: end },
  })
}

describe('M2 教室申请与审批', { concurrency: 1 }, () => {
  before(async () => {
    loadEnv()
    stub = await startStub(TOKEN)
    process.env.D1_BASE_URL = stub.url
    process.env.D2_BASE_URL = stub.url
    process.env.D3_BASE_URL = stub.url
    const migrate = await import('../scripts/migrate.js')
    await migrate.runMigrations()
    const appModule = await import('../src/app.js')
    const service = await import('../src/services/applications.js')
    const db = await import('../src/db.js')
    expireOverdue = service.expireOverdue
    getPool = db.getPool
    closePool = db.closePool
    server = appModule.createApp().listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  beforeEach(async () => {
    stub.reset()
    await getPool().query('DELETE FROM application_approvals')
    await getPool().query('DELETE FROM classroom_applications')
  })

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (stub) await stub.close()
    if (closePool) await closePool()
  })

  test('M2-01 无权限用户申请整教室被拒绝', async () => {
    const denied = await apply(userToken(1))
    assert.equal(denied.status, 403)
    assert.equal(denied.json.code, 'FORBIDDEN')
    const mismatch = await apply(userToken(3))
    assert.equal(mismatch.status, 403)
    assert.equal(mismatch.json.code, 'FORBIDDEN')
    const listed = await api('GET', '/api/m2/applications/me', { token: userToken(1) })
    assert.equal(listed.json.data.total, 0)
  })

  test('M2-02 有权限用户申请空闲教室后进入一级审批', async () => {
    const created = await apply(userToken(2))
    assert.equal(created.status, 201)
    assert.equal(created.json.data.status, 'PENDING_L1')
    assert.equal(created.json.data.applicant_id, '2')
    assert.ok(created.json.data.reservation_id)
    assert.equal(stub.reservations.at(-1).status, 'HELD')
    assert.equal(stub.logs.at(-1).action, 'APPLICATION_CREATE')
    assert.equal(stub.logs.at(-1).result, 'SUCCESS')
  })

  test('M2-03 与已有占用冲突时申请失败且不保留记录', async () => {
    stub.occupy('201', START, END)
    const conflict = await apply(userToken(2))
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.code, 'RESOURCE_CONFLICT')
    const listed = await api('GET', '/api/m2/applications/me', { token: userToken(2) })
    assert.equal(listed.json.data.total, 0)
  })

  test('M2-04 到 M2-07 两级审批、驳回与越权', async () => {
    const created = await apply(userToken(2))
    const id = created.json.data.id
    const pending = await api('GET', '/api/m2/approvals/pending?approval_level=1', { token: userToken(4) })
    assert.equal(pending.json.data.total, 1)
    assert.equal(pending.json.data.items[0].application.id, id)
    const pendingDenied = await api('GET', '/api/m2/approvals/pending', { token: userToken(2) })
    assert.equal(pendingDenied.status, 403)

    const wrongLevel = await api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(5), body: {} })
    assert.equal(wrongLevel.status, 403)
    const stranger = await api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(1), body: {} })
    assert.equal(stranger.status, 403)

    const missingReason = await api('POST', `/api/m2/applications/${id}/reject`, { token: userToken(4), body: {} })
    assert.equal(missingReason.status, 400)

    const levelOne = await api('POST', `/api/m2/applications/${id}/approve`, {
      token: userToken(4),
      body: { comment: '同意申请' },
    })
    assert.equal(levelOne.status, 200)
    assert.equal(levelOne.json.data.status, 'PENDING_L2')
    assert.equal(stub.reservations.find((item) => item.source_id === id).status, 'HELD')

    const levelOneAgain = await api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(4), body: {} })
    assert.equal(levelOneAgain.status, 403)

    const levelTwo = await api('POST', `/api/m2/applications/${id}/approve`, {
      token: userToken(5),
      body: { comment: '最终同意' },
    })
    assert.equal(levelTwo.status, 200)
    assert.equal(levelTwo.json.data.status, 'APPROVED')
    assert.equal(stub.reservations.find((item) => item.source_id === id).status, 'CONFIRMED')

    const rejected = await apply(userToken(2), '202', '2026-12-01T13:00:00+08:00', '2026-12-01T15:00:00+08:00')
    const rejectId = rejected.json.data.id
    const rejection = await api('POST', `/api/m2/applications/${rejectId}/reject`, {
      token: userToken(4),
      body: { comment: '时间不合适' },
    })
    assert.equal(rejection.status, 200)
    assert.equal(rejection.json.data.status, 'REJECTED')
    assert.equal(stub.reservations.find((item) => item.source_id === rejectId).status, 'RELEASED')
    const approvals = await api('GET', `/api/m2/applications/${rejectId}/approvals`, { token: userToken(2) })
    assert.equal(approvals.json.data[0].comment, '时间不合适')
    assert.equal(approvals.json.data[0].decision, 'REJECTED')
    const admin = await api('GET', '/api/m2/admin/applications?status=APPROVED', { token: userToken(5) })
    assert.equal(admin.status, 200)
    assert.equal(admin.json.data.total, 1)
    const adminDenied = await api('GET', '/api/m2/admin/applications', { token: userToken(2) })
    assert.equal(adminDenied.status, 403)
  })

  test('M2-08 超过审批时限后自动拒绝并释放预占', async () => {
    const created = await apply(userToken(2))
    const id = created.json.data.id
    await getPool().query(
      `UPDATE classroom_applications SET approval_deadline = '2000-01-01 00:00:00' WHERE id = ?`,
      [id],
    )
    const result = await expireOverdue()
    assert.equal(result.expired, 1)
    const detail = await api('GET', `/api/m2/applications/${id}`, { token: userToken(2) })
    assert.equal(detail.json.data.application.status, 'REJECTED')
    assert.equal(stub.reservations.find((item) => item.source_id === id).status, 'RELEASED')
    const late = await api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(4), body: {} })
    assert.equal(late.status, 409)
  })

  test('M2-09 申请人撤销待审批申请后不能再审批', async () => {
    const created = await apply(userToken(2))
    const id = created.json.data.id
    const other = await api('POST', `/api/m2/applications/${id}/cancel`, { token: userToken(3) })
    assert.equal(other.status, 403)
    const cancelled = await api('POST', `/api/m2/applications/${id}/cancel`, { token: userToken(2) })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.json.data.status, 'CANCELLED')
    assert.equal(stub.reservations.find((item) => item.source_id === id).status, 'RELEASED')
    const late = await api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(4), body: {} })
    assert.equal(late.status, 409)
  })

  test('M2-10 用户能看到自己的申请、状态和审批意见', async () => {
    const created = await apply(userToken(2))
    const id = created.json.data.id
    await api('POST', `/api/m2/applications/${id}/approve`, {
      token: userToken(4),
      body: { comment: '一级通过' },
    })
    const mine = await api('GET', '/api/m2/applications/me', { token: userToken(2) })
    assert.equal(mine.json.data.total, 1)
    assert.equal(mine.json.data.items[0].status, 'PENDING_L2')
    const detail = await api('GET', `/api/m2/applications/${id}`, { token: userToken(2) })
    assert.equal(detail.json.data.approvals[0].comment, '一级通过')
    const hidden = await api('GET', `/api/m2/applications/${id}`, { token: userToken(3) })
    assert.equal(hidden.status, 403)
    const anonymous = await api('GET', '/api/m2/applications/me')
    assert.equal(anonymous.status, 401)
  })

  test('M2-11 同时审批同一申请只有一次成功', async () => {
    const created = await apply(userToken(2))
    const id = created.json.data.id
    const [first, second] = await Promise.all([
      api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(4), body: { comment: '甲' } }),
      api('POST', `/api/m2/applications/${id}/approve`, { token: userToken(4), body: { comment: '乙' } }),
    ])
    const statuses = [first.status, second.status].sort()
    assert.deepEqual(statuses, [200, 409])
    const detail = await api('GET', `/api/m2/applications/${id}`, { token: userToken(4) })
    assert.equal(detail.json.data.application.status, 'PENDING_L2')
    assert.equal(detail.json.data.approvals.length, 1)
  })

  test('可按学院、楼宇和容量查询教室可用性', async () => {
    stub.occupy('201', START, END)
    const result = await api(
      'GET',
      `/api/m2/classrooms?college_id=1&building=${encodeURIComponent('教学楼A')}&min_capacity=50&start_time=${encodeURIComponent(START)}&end_time=${encodeURIComponent(END)}`,
      { token: userToken(1) },
    )
    assert.equal(result.status, 200)
    const ids = result.json.data.map((item) => item.classroom_id).sort()
    assert.deepEqual(ids, ['201'])
    assert.equal(result.json.data[0].available, false)
    assert.equal(result.json.data[0].capacity, 80)
  })

  test('无学院教室允许有申请权限的老师预约，停用教室不可申请', async () => {
    const open = await apply(userToken(2), '202')
    assert.equal(open.status, 201)
    const maintenance = await apply(userToken(2), '203')
    assert.equal(maintenance.status, 422)
    const partial = await apply(userToken(2), '204')
    assert.equal(partial.status, 422)
  })
})
