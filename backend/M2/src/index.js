import { createApp } from './app.js'
import { config } from './config.js'
import { expireOverdue } from './services/applications.js'

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
  if (timer) clearInterval(timer)
  server.close()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
