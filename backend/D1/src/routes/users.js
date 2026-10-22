import { Router } from 'express'
import { pool } from '../db.js'
import { ok, fail } from '../utils/response.js'
import { toIso } from '../utils/format.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
router.use(authRequired)

// 查询某个用户的私有资料（含角色），返回 UserPrivate 结构
async function loadPrivate(userId) {
  const [rows] = await pool.query(
    `SELECT id, username, nickname, email, phone, college_id, status, created_at
     FROM users WHERE id = ?`,
    [userId]
  )
  const user = rows[0]
  if (!user) return null

  const [roleRows] = await pool.query(
    `SELECT r.role_code
     FROM roles r JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [userId]
  )

  return {
    id: String(user.id),
    username: user.username,
    nickname: user.nickname,
    college_id: user.college_id ? String(user.college_id) : null,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roles: roleRows.map(r => r.role_code),
    created_at: toIso(user.created_at)
  }
}

// 本人资料：GET /api/d1/users/me
router.get('/me', async (req, res, next) => {
  try {
    const data = await loadPrivate(req.user.id)
    if (!data) return res.status(404).json(fail('NOT_FOUND', '用户不存在'))
    res.json(ok(data))
  } catch (err) {
    next(err)
  }
})

// 修改本人资料：PATCH /api/d1/users/me（仅昵称/邮箱/手机号）
router.patch('/me', async (req, res, next) => {
  try {
    const { nickname, email, phone } = req.body || {}
    const sets = []
    const params = []

    if (nickname !== undefined) { sets.push('nickname = ?'); params.push(nickname) }
    if (email !== undefined) { sets.push('email = ?'); params.push(email) }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone) }

    if (sets.length === 0) {
      return res.status(400).json(fail('VALIDATION_ERROR', '没有可修改的字段'))
    }

    params.push(req.user.id)
    await pool.query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params)

    const data = await loadPrivate(req.user.id)
    res.json(ok(data, '保存成功'))
  } catch (err) {
    next(err)
  }
})

export default router
