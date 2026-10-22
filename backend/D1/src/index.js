import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { pool } from './db.js'
import { ok, fail } from './utils/response.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'

const app = express()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/api/d1/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json(ok({ status: 'UP' }))
  } catch {
    res.status(503).json(fail('DEPENDENCY_UNAVAILABLE', '数据库不可用'))
  }
})

// 路由挂载（统一入口）
app.use('/api/d1/auth', authRoutes)
app.use('/api/d1/users', userRoutes)

// 404
app.use((req, res) => {
  res.status(404).json(fail('NOT_FOUND', '接口不存在'))
})

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json(fail('INTERNAL_ERROR', '服务器内部错误'))
})

app.listen(config.port, () => {
  console.log(`D1 服务已启动：http://localhost:${config.port}`)
})
