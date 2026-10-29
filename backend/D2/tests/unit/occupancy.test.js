import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateTime, offsetMinutes, withinOpeningHours } from '../../src/time.js'
import { availabilityBody, reservationBody, maintenanceBody, transitionBody, reservationQuery } from '../../src/validation.js'
import { loadConfig } from '../../src/config.js'

const interval = { start_time: '2035-01-01T09:00:00+08:00', end_time: '2035-01-01T10:00:00+08:00' }
const invalid = fn => assert.throws(fn, error => error.status === 400)

test('RFC3339 严格校验日期、秒、毫秒、时区和数据库范围，等价时间规范化', () => {
  assert.equal(dateTime('2035-01-01T09:00:00.12+08:00'), '2035-01-01 01:00:00.120')
  assert.equal(dateTime('2024-02-29T23:59:59.999Z'), '2024-02-29 23:59:59.999')
  for (const value of ['2035-02-29T00:00:00Z', '2035-01-01T24:00:00Z', '2035-01-01T09:00Z',
    '2035-01-01T09:00:00', '2035-01-01T09:00:00.1234Z', '2035-01-01T09:00:60Z',
    '2035-01-01T09:00:00+14:01', '1000-01-01T00:00:00+01:00', '9999-12-31T23:59:59-01:00', null]) invalid(() => dateTime(value))
  assert.equal(offsetMinutes('-03:30'), -210)
  for (const value of ['+15:00', '+08:60', 'Asia/Shanghai']) assert.throws(() => offsetMinutes(value))
})

test('普通、全天及跨午夜开放窗口包含整个区间，支持负时区和边界', () => {
  const inside = (open, close, start, end, offset = 480) => withinOpeningHours({ open_time: open, close_time: close }, dateTime(start), dateTime(end), offset)
  assert.equal(inside('08:00:00', '22:00:00', '2035-01-01T08:00:00+08:00', '2035-01-01T22:00:00+08:00'), true)
  assert.equal(inside('08:00:00', '22:00:00', '2035-01-01T22:00:00+08:00', '2035-01-01T22:00:01+08:00'), false)
  assert.equal(inside('08:00:00', '22:00:00', '2035-01-01T09:00:00+08:00', '2035-01-02T09:00:00+08:00'), false)
  assert.equal(inside('22:00:00', '06:00:00', '2035-01-01T23:00:00+08:00', '2035-01-02T06:00:00+08:00'), true)
  assert.equal(inside('22:00:00', '06:00:00', '2035-01-02T05:00:00+08:00', '2035-01-02T06:00:00.001+08:00'), false)
  assert.equal(inside('22:00:00', '06:00:00', '2035-01-01T20:00:00+08:00', '2035-01-01T23:00:00+08:00'), false)
  assert.equal(inside('00:00:00', '00:00:00', '2035-01-01T00:00:00Z', '2035-01-03T00:00:00Z'), true)
  assert.equal(inside('08:00:00', '22:00:00', '2035-01-01T08:00:00-03:30', '2035-01-01T09:00:00-03:30', -210), true)
})

test('占用、维修、筛选和转换输入只接受契约字段与类型', () => {
  const body = { resource_type: 'SEAT', resource_id: '1', source_module: 'M1', source_id: '2', ...interval }
  assert.equal(reservationBody(body).start_time, '2035-01-01 01:00:00.000')
  for (const change of [{ hold_expires_at: null }, { source_module: 'M3' }, { source_id: 2 }, { user_id: '3' },
    { end_time: interval.start_time }, { resource_type: 'ROOM' }]) invalid(() => reservationBody({ ...body, ...change }))
  invalid(() => availabilityBody({ resource_type: 'SEAT', ...interval, filters: { min_capacity: 1 } }, true))
  invalid(() => availabilityBody({ resource_type: 'CLASSROOM', ...interval, filters: { is_bookable_whole: 'true' } }, true))
  invalid(() => availabilityBody({ resource_type: 'SEAT', resource_id: '1', ...interval, filters: {} }))
  assert.deepEqual(transitionBody(undefined), {})
  invalid(() => transitionBody({ reason: 'x' }))
  invalid(() => transitionBody({ reason: '' }, true))
  invalid(() => transitionBody({ reason: 'x'.repeat(256) }, true))
  for (const revision of [undefined, 0, -1, 1.1, '1', 2147483648]) invalid(() => maintenanceBody({ ticket_id: '1', classroom_id: '2', active: true, revision }))
  for (const query of [{ status: 'EXPIRED' }, { source_id: ['1'] }, { page: '0' }, { page_size: '101' }]) invalid(() => reservationQuery(query))
})

test('服务密钥独立且无默认值，过期任务与时区配置严格校验', () => {
  const env = { DB_HOST: 'db', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test-only', D1_BASE_URL: 'http://d1:3004' }
  const config = loadConfig(env)
  assert.deepEqual(config.serviceTokens, {})
  assert.equal(config.holdTtlSeconds, 300)
  assert.equal(config.expiryPollMs, 5000)
  assert.equal(config.businessOffsetMinutes, 480)
  for (const change of [{ D2_M1_SERVICE_TOKEN: 'short' }, { D2_M1_SERVICE_TOKEN: 'x'.repeat(32), D2_M2_SERVICE_TOKEN: 'x'.repeat(32) },
    { D2_M3_SERVICE_TOKEN: 'x'.repeat(32) + ' ' }, { HOLD_TTL_SECONDS: '0' }, { EXPIRY_POLL_MS: '0' }, { BUSINESS_UTC_OFFSET: '+15:00' }]) {
    assert.throws(() => loadConfig({ ...env, ...change }))
  }
})
