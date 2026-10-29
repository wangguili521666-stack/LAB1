import {permissions,active,problem} from '../rbac.js'
import { Router } from 'express'
import { pool } from '../db.js'
import { ok, fail } from '../utils/response.js'
import { toIso } from '../utils/format.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
router.use(authRequired)
router.use((req,res,next)=>active(req.user.id).then(()=>next(),next))

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
    permissions: await permissions(userId),
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

router.get('/me/records', async(req,res,next)=>{try{
  const type=req.query.type||'all',page=Number(req.query.page||1),size=Number(req.query.page_size||20);
  const services={seat_bookings:['M1','/api/m1/bookings/me'],classroom_applications:['M2','/api/m2/applications/me'],repair_tickets:['M3','/api/m3/tickets/me']};
  if(type!=='all'&&!Object.hasOwn(services,type))throw problem(400,'记录类型无效');
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100)throw problem(400,'分页无效');
  const selected=Object.entries(services).filter(([key])=>type==='all'||key===type);
  const pairs=await Promise.all(selected.map(async([key,[module,path]])=>{try{const base=process.env[module+'_BASE_URL'];if(!base)throw Error();const r=await fetch(base+path+'?'+new URLSearchParams({page,page_size:size}),{headers:{Authorization:req.headers.authorization},signal:AbortSignal.timeout(5000),redirect:'error'});const j=await r.json();if(!r.ok||j.code!=='OK'||!Array.isArray(j.data?.items))throw Error();return [key,j.data]}catch{throw problem(503,module+' 记录服务暂不可用，请重试')}}));
  res.json(ok(Object.fromEntries(pairs)));
}catch(e){next(e)}});
export default router
