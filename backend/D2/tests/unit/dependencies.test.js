import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createD1Client, createD3Sender } from '../../src/dependencies.js'

const reply = (status, data) => new Response(JSON.stringify({ code: status < 400 ? 'OK' : 'ERROR', data }), { status })
const identity = { id: '1', college_id: null, roles: ['STUDENT'], status: 'ACTIVE', email: 'not-returned@example.invalid' }

test('D1 原用户凭证被转发，可信上下文不保留个人资料', async () => {
  const client = createD1Client({ baseUrl: 'http://d1.test', timeoutMs: 100, fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/api/d1/users/me')
    assert.equal(options.headers.Authorization, 'Bearer unit-user-token')
    assert.equal(options.redirect, 'error')
    return reply(200, identity)
  } })
  assert.deepEqual(await client.identity('unit-user-token'), { id: '1', college_id: null, roles: ['STUDENT'] })
})

test('D1 无效凭证、禁用、异常 Schema、接口缺失、网络异常均拒绝访问', async () => {
  for (const [response, status] of [[reply(401, null), 401], [reply(200, { ...identity, status: 'DISABLED' }), 403],
    [reply(200, { ...identity, id: 1 }), 503], [reply(404, null), 503]]) {
    const client = createD1Client({ baseUrl: 'http://d1.test', timeoutMs: 100, fetchImpl: async () => response })
    await assert.rejects(client.identity('test-token'), error => error.status === status)
  }
  const client = createD1Client({ baseUrl: 'http://d1.test', timeoutMs: 100, fetchImpl: async () => { throw Error('network') } })
  await assert.rejects(client.identity('test-token'), error => error.status === 503)
})

test('学院不存在为 422，学院列表接口缺失或异常为 503', async () => {
  for (const [response, status] of [[reply(200, []), 422], [reply(404, null), 503], [reply(200, [{ id: 1, name: 'X' }]), 503]]) {
    const client = createD1Client({ baseUrl: 'http://d1.test', timeoutMs: 100, fetchImpl: async () => response })
    await assert.rejects(client.validateCollege('1', 'test-token'), error => error.status === status)
  }
})

test('D3 使用独立服务凭证，只认可契约成功响应', async () => {
  const payload = { module: 'D2', result: 'SUCCESS' }
  const send = createD3Sender({ baseUrl: 'http://d3.test', token: 'unit-service-token', timeoutMs: 100,
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, '/api/d3/internal/logs')
      assert.equal(options.headers['X-D3-Service-Token'], 'unit-service-token')
      assert.equal(options.headers.Authorization, undefined)
      assert.deepEqual(JSON.parse(options.body), payload)
      return reply(201, { id: '9007199254740993' })
    } })
  await send(payload)
  const unavailable = createD3Sender({ baseUrl: null, token: null, timeoutMs: 100 })
  await assert.rejects(unavailable(payload), error => error.status === 503)
})
