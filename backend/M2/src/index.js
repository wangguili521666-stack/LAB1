import { createApp } from './app.js'
import { closePool } from './db.js'
import { config } from './config.js'
import { expireOverdue } from './services/applications.js'

import { deliverLogs } from './clients/d3.js'
const auditTimer = setInterval(() => deliverLogs().catch(() => console.error('M2_AUDIT_RETRY')), 2000)
auditTimer.unref()
const app = createApp()
const server = app.listen(config.port, () => {
  console.log(`M2 服务已启动：http://localhost:${config.port}`)
})

let timer
if (process.env.M2_DISABLE_SCHEDULER !== '1') {
  timer = setInterval(() => {
    expireOverdue().catch((err) => console.error('超时任务失败：', err.message))
  }, config.expireIntervalMs)
  timer.unref()
}

function shutdown() {
  clearInterval(auditTimer)
  if (timer) clearInterval(timer)
  server.close(() => { closePool().catch(() => { process.exitCode = 1 }) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
