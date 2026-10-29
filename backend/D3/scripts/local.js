import { createLocalApp } from './acceptance-app.js'
import { MysqlStore, createPool } from '../src/stores/mysql.js'
import { loadLocalConfig } from './local-config.js'

let store
try {
  const config = await loadLocalConfig()
  store = new MysqlStore(createPool(config.database))
  await store.check()
  const app = createLocalApp({ store, config })
  const server = app.listen(config.port, config.host, () => {
    console.log(`D3 本地数据库模式：http://${config.host}:${config.port}`)
    console.log(`浏览器验收页面：http://${config.host}:${config.port}/local/d3/`)
    console.log(`数据真实保存到 ${config.database.database}，重启保留；用户身份暂用本地模拟 D1。`)
    console.log('假身份与 Mock 模式一致。查看数据库：npm.cmd run db:status:local')
  })
  server.on('error', async error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用，请关闭该端口的旧 D3 服务或修改 .env.local 的 PORT` : `D3 监听失败：${error.code || 'UNKNOWN'}`)
    await store.close()
    process.exitCode = 1
  })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    const timer = setTimeout(() => process.exit(1), 10000).unref()
    server.close(async () => { await store.close(); clearTimeout(timer) })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} catch (error) {
  console.error(error.code ? `本地 D3 启动失败：${error.code}` : error.message)
  if (store) await store.close()
  process.exitCode = 1
}
