import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { d1Authenticator, serviceIdentity } from '../src/auth.js'
import { runtimeConfig } from '../src/config.js'

test('真实 HTTP 调用 D1：验证路径、令牌、角色、停用账号与 BIGINT 字符串', async t => {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/d1/users/me')
    const token = req.headers.authorization
    res.setHeader('content-type', 'application/json')
    if (token === 'Bearer expired') { res.statusCode = 401; return res.end('{}') }
    if (token === 'Bearer broken') { res.statusCode = 503; return res.end('{}') }
    if (token === 'Bearer malformed') return res.end('{')
    if (token === 'Bearer slow') return
    const data = { id: '9007199254740993', roles: ['SYSTEM_ADMIN'], status: token === 'Bearer disabled' ? 'DISABLED' : 'ACTIVE' }
    if (token === 'Bearer no-roles') delete data.roles
    res.end(JSON.stringify({ code: 'OK', data }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const authenticate = d1Authenticator({ baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 100 })
  assert.deepEqual(await authenticate('Bearer valid'), { id: '9007199254740993', roles: ['SYSTEM_ADMIN'] })
  for (const [token, status] of [['expired', 401], ['disabled', 403], ['broken', 503], ['malformed', 503], ['no-roles', 503], ['slow', 503]]) {
    await assert.rejects(authenticate(`Bearer ${token}`), error => error.status === status, token)
  }
  await assert.rejects(authenticate(undefined), error => error.status === 401)
})

test('服务身份不能由请求体决定；不同模块使用独立凭据', () => {
  assert.deepEqual(serviceIdentity('token-a', { M1: 'token-a', M2: 'token-b' }), { module: 'M1' })
  assert.throws(() => serviceIdentity('unknown', { M1: 'token-a' }), error => error.status === 401)
})

test('正式启动拒绝缺少凭据、重复凭据和错误模块；不支持切换到 Mock 身份', () => {
  const env = { DB_PASSWORD: 'fake-test-only', D3_SERVICE_TOKENS: JSON.stringify({ M1: 'a'.repeat(32), M2: 'b'.repeat(32) }) }
  const config = runtimeConfig(env)
  assert.equal(config.database.database, 'campus_d3')
  assert.throws(() => runtimeConfig({ ...env, DB_PASSWORD: '' }))
  for (const credentials of [{}, [], { M1: 'short' }, { M1: 'a'.repeat(32), M2: 'a'.repeat(32) }, { D3: 'a'.repeat(32) }]) {
    assert.throws(() => runtimeConfig({ ...env, D3_SERVICE_TOKENS: JSON.stringify(credentials) }))
  }
  assert.throws(() => runtimeConfig({ ...env, D1_BASE_URL: 'http://user:password@example.com' }))
  assert.throws(() => runtimeConfig({ ...env, PORT: '1.5' }))
})
