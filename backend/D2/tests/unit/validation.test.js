import { test } from 'node:test'
import assert from 'node:assert/strict'
import { id, classroomBody, seatBody, classroomQuery, seatQuery } from '../../src/validation.js'
import { loadConfig } from '../../src/config.js'

const room = { building: 'A', room_number: '101', capacity: 30, is_bookable_whole: true, open_time: '08:00:00', close_time: '22:00:00' }
const rejects = fn => assert.throws(fn, error => error.status === 400 && error.code === 'VALIDATION_ERROR')

test('BIGINT 字符串不丢精度，拒绝数值、溢出、负数及非规范 ID', () => {
  assert.equal(id('9007199254740993'), '9007199254740993')
  assert.equal(id('9223372036854775807'), '9223372036854775807')
  for (const value of [1, '0', '-1', '01', '1.0', '1e2', '9223372036854775808', null, ['1']]) rejects(() => id(value))
})

test('主数据必填、白名单、枚举、类型和 Unicode 长度校验', () => {
  assert.equal(classroomBody(room).status, 'AVAILABLE')
  assert.deepEqual(classroomBody(room).equipment, {})
  assert.equal(classroomBody(room).college_id, null)
  assert.equal(classroomBody({ ...room, building: ' 中楼 ' }).building, '中楼')
  assert.equal(classroomBody({ ...room, building: '楼'.repeat(100) }).building.length, 100)
  for (const changes of [{ capacity: 0 }, { capacity: '30' }, { capacity: 1.5 }, { capacity: 2147483648 },
    { equipment: [] }, { equipment: null }, { is_bookable_whole: 'true' }, { open_time: '24:00:00' },
    { close_time: '22:60:00' }, { building: ' ' }, { building: '楼'.repeat(101) },
    { college_id: 1 }, { user_id: '1' }, { status: 'AVAILABLE' }]) rejects(() => classroomBody({ ...room, ...changes }))
  for (const value of [null, [], {}, 'text']) rejects(() => classroomBody(value))
  rejects(() => classroomBody({}, true))
  rejects(() => classroomBody({ status: 'OFFLINE' }, true))
  rejects(() => seatBody({ classroom_id: '1', seat_number: 'A', socket_type: 'USB' }))
  rejects(() => seatBody({ classroom_id: '1' }, true))
  assert.deepEqual(seatBody({ status: 'DISABLED' }, true), { status: 'DISABLED' })
})

test('分页、查询参数拒绝重复/数组、注入和含糊的布尔值', () => {
  assert.deepEqual(classroomQuery({}), { page: 1, page_size: 20 })
  assert.equal(classroomQuery({ is_bookable_whole: 'false' }).is_bookable_whole, false)
  for (const value of [{ page: '0' }, { page_size: '101' }, { page: '1e2' }, { page: ['1', '2'] },
    { page: '1 OR 1=1' }, { min_capacity: '-1' }, { is_bookable_whole: '0' }, { status: {} }, { user_id: '1' }]) {
    rejects(() => classroomQuery(value))
  }
  rejects(() => seatQuery({ status: ['AVAILABLE', 'DISABLED'] }))
})

test('启动配置不提供默认数据库密码或凭证，拒绝带密钥的 URL', () => {
  const env = { DB_HOST: 'test-db', DB_NAME: 'campus_d2', DB_USER: 'd2_app', DB_PASSWORD: 'test-only', D1_BASE_URL: 'http://d1:3004' }
  assert.equal(loadConfig(env).port, 3005)
  assert.throws(() => loadConfig({ ...env, DB_PASSWORD: '' }), /DB_PASSWORD/)
  assert.throws(() => loadConfig({ ...env, D1_BASE_URL: 'http://user:secret@d1:3004' }), /D1_BASE_URL/)
  assert.throws(() => loadConfig({ ...env, PORT: 'NaN' }), /PORT/)
  assert.throws(() => loadConfig({ ...env, D3_BASE_URL: 'http://d3:3006' }), /D3_SERVICE_TOKEN/)
})
