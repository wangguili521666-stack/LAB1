import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { config } from '../config.js'
import { ok, fail } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

// 注册：POST /api/d1/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, nickname, email, phone, college_id } = req.body || {}
    if (!username || !password) {
      return res.status(400).json(fail('VALIDATION_ERROR', '用户名和密码不能为空'))
    }

    const [dup] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
    if (dup.length > 0) {
      return res.status(409).json(fail('DUPLICATE_OPERATION', '用户名已存在'))
    }

    if (college_id) {
      const [cols] = await pool.query('SELECT id FROM colleges WHERE id = ?', [college_id])
      if (cols.length === 0) {
        return res.status(422).json(fail('VALIDATION_ERROR', '学院不存在'))
      }
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      `INSERT INTO users (username, password_hash, nickname, email, phone, college_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [username, passwordHash, nickname || username, email || null, phone || null, college_id || null]
    )
    const userId = result.insertId

    // 分配默认 STUDENT 角色
    await pool.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id, assigned_at)
       SELECT ?, id, NOW() FROM roles WHERE role_code = 'STUDENT'`,
      [userId]
    )

    res.status(201).json(ok({ user_id: String(userId), username }, '注册成功'))
  } catch (err) {
    next(err)
  }
})

// 登录：POST /api/d1/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json(fail('VALIDATION_ERROR', '用户名和密码不能为空'))
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = rows[0]
    if (!user) {
      return res.status(401).json(fail('UNAUTHORIZED', '用户名或密码错误'))
    }
    if (user.status !== 'ACTIVE') {
      return res.status(401).json(fail('UNAUTHORIZED', '账号已禁用'))
    }

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      return res.status(401).json(fail('UNAUTHORIZED', '用户名或密码错误'))
    }

    const token = jwt.sign(
      { sub: String(user.id), username: user.username },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    )

    res.json(ok({
      access_token: token,
      token_type: 'Bearer',
      expires_in: config.jwt.expiresIn
    }, '登录成功'))
  } catch (err) {
    next(err)
  }
})

// 登出：POST /api/d1/auth/logout
// JWT 无状态，服务端不落库；前端清除本地 token 即可。保留接口便于后续接入撤销/审计。
router.post('/logout', authRequired, (req, res) => {
  res.json(ok({ success: true }, '已登出'))
})

export default router
