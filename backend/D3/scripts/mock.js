import { createApp } from '../src/app.js'
import { MemoryStore } from '../src/stores/memory.js'
import { mockAuthenticate, mockServiceTokens } from '../fixtures/identities.js'

if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止启动 Mock')
const port = Number(process.env.D3_MOCK_PORT || 3006)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('D3_MOCK_PORT 无效')
const app = createApp({ store: new MemoryStore(), authenticateUser: mockAuthenticate, serviceTokens: mockServiceTokens,
  corsOrigin: process.env.D3_MOCK_CORS_ORIGIN || null })
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`D3 Mock：http://127.0.0.1:${port}；重启清空数据；不会连接数据库、D1 或任何发送渠道。`)
  console.log('联调假身份和示例见 README.md；另一个终端运行 npm run smoke 可验证业务闭环。')
})
server.on('error', error => { console.error({ code: error.code || 'LISTEN_FAILED' }); process.exitCode = 1 })
process.once('SIGINT', () => server.close())
process.once('SIGTERM', () => server.close())
