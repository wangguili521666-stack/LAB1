import { createApp } from './app.js'
import { d1Authenticator } from './auth.js'
import { runtimeConfig } from './config.js'
import { createPool, MysqlStore } from './stores/mysql.js'

let store
try {
  const config = runtimeConfig()
  store = new MysqlStore(createPool(config.database))
  await store.check()
  const app = createApp({ store, serviceTokens: config.serviceTokens, authenticateUser: d1Authenticator(config.d1), corsOrigin: config.corsOrigin })
  const server = app.listen(config.port, config.host, () => console.log(`D3 启动：http://${config.host}:${config.port}（MySQL，真实 D1 认证）`))
  server.on('error', async error => {
    console.error({ code: error.code || 'LISTEN_FAILED' })
    await store.close()
    process.exitCode = 1
  })
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    const timer = setTimeout(() => process.exit(1), 10000).unref()
    server.close(async () => { await store.close(); clearTimeout(timer) })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} catch (error) {
  console.error(error.code ? `D3 启动失败：${error.code}，请检查数据库与迁移` : error.message)
  if (store) await store.close()
  process.exitCode = 1
}
