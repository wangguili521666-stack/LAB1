import express from 'express'
import cors from 'cors'
import { getPool } from './db.js'
import { ok, fail } from './utils/response.js'
import { HttpError } from './utils/httpError.js'
import m2Routes from './routes/m2.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/m2/health', async (req, res) => {
    try {
      await getPool().query('SELECT 1')
      res.json(ok({ status: 'UP' }))
    } catch {
      res.status(503).json(fail('DEPENDENCY_UNAVAILABLE', '数据库不可用'))
    }
  })

  app.use('/api/m2', m2Routes)

  app.use((req, res) => {
    res.status(404).json(fail('NOT_FOUND', '接口不存在'))
  })

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json(fail('VALIDATION_ERROR', '请求体不是合法 JSON'))
    }
    if (err instanceof HttpError) return res.status(err.status).json(fail(err.code, err.message))
    console.error(err)
    res.status(500).json(fail('INTERNAL_ERROR', '服务器内部错误'))
  })

  return app
}
