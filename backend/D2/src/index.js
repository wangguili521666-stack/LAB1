import 'dotenv/config'
import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { createApp, assertReady } from './app.js'
import { createD1Client, createD3Sender } from './dependencies.js'
import { startAuditWorker } from './audit.js'
import { startExpiryWorker } from './expiry.js'

let pool
try {
  const config = loadConfig()
  pool = createPool(config.db)
  await assertReady(pool)
  const d1 = createD1Client({ baseUrl: config.d1BaseUrl, timeoutMs: config.dependencyTimeoutMs })
  const app = createApp({ pool, d1, serviceTokens: config.serviceTokens, reservationOptions: config })
  const server = app.listen(config.port, config.host, () => {
    console.log(`D2 资源服务已启动，端口 ${config.port}`)
  })
  const stopAudit = config.d3BaseUrl ? startAuditWorker({
    pool,
    send: createD3Sender({ baseUrl: config.d3BaseUrl, token: config.d3ServiceToken, timeoutMs: config.dependencyTimeoutMs }),
    pollMs: config.auditPollMs
  }) : async () => {}
  if (!config.d3BaseUrl) console.warn('D3 尚未配置：审计保留在 D2 outbox，配置后重启以继续发送。')
  const stopExpiry = startExpiryWorker({ pool, pollMs: config.expiryPollMs })
  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    await new Promise(resolve => server.close(resolve))
    await stopAudit()
    await stopExpiry()
    await pool.end()
  }
  server.on('error', async error => {
    console.error(`D2 监听失败（${error.code || 'LISTEN_ERROR'}）`)
    await stopAudit()
    await stopExpiry()
    await pool.end()
    process.exitCode = 1
  })
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} catch (error) {
  console.error(`D2 启动失败（${error.code || 'CONFIG_OR_MIGRATION_ERROR'}），请检查配置并先执行迁移。`)
  if (pool) await pool.end()
  process.exitCode = 1
}
