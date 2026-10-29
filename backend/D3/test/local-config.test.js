import test from 'node:test'
import assert from 'node:assert/strict'
import { validateLocalConfig } from '../scripts/local-config.js'

const local = { PORT: '3106', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'campus_d3_local', DB_USER: 'd3_local_app', DB_PASSWORD: 'fake-test-only' }

test('本地持久化入口只连接本地专用库，不能把模拟身份带到团队环境', () => {
  const config = validateLocalConfig(local, {})
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 3106)
  assert.equal(config.database.database, 'campus_d3_local')
  for (const patch of [{ DB_HOST: 'db.team.example' }, { DB_NAME: 'campus_d3' }, { DB_USER: 'root' }, { DB_PASSWORD: '' }, { PORT: 'bad' }]) {
    assert.throws(() => validateLocalConfig({ ...local, ...patch }, {}))
  }
  assert.throws(() => validateLocalConfig(local, { NODE_ENV: 'production' }))
})

test('本地数据库端口可切换，真实业务服务代码不依赖连接参数', () => {
  const config = validateLocalConfig({ ...local, DB_PORT: '3307' }, {})
  assert.equal(config.database.port, 3307)
  assert.equal(config.port, 3106)
})
