import {pool} from './db.js'
export const problem=(status,message)=>Object.assign(new Error(message),{status})
export async function permissions(id,db=pool){const [rs]=await db.query('SELECT DISTINCT p.permission_code FROM permissions p JOIN role_permissions rp ON rp.id_permissions=p.id JOIN user_roles ur ON ur.role_id=rp.id_role WHERE ur.user_id=?',[id]);return rs.map(r=>r.permission_code)}
export async function identity(id,db=pool){const [[u]]=await db.query('SELECT id,username,nickname,college_id,status FROM users WHERE id=?',[id]);if(!u)return null;const [rs]=await db.query('SELECT role_code FROM roles JOIN user_roles ON roles.id=user_roles.role_id WHERE user_id=?',[id]);return {...u,id:String(u.id),college_id:u.college_id?String(u.college_id):null,roles:rs.map(r=>r.role_code),permissions:await permissions(id,db)}}
export async function active(id,db=pool){const u=await identity(id,db);if(u?.status!=='ACTIVE')throw problem(403,'账号不可用');return u}
export async function admin(id,db=pool){const u=await active(id,db);if(!u.roles.includes('SYSTEM_ADMIN'))throw problem(403,'仅系统管理员可以管理角色权限');return u}
export const identifier=v=>{if(typeof v!=='string'||! /^[1-9]\d{0,18}$/.test(v)||BigInt(v)>9223372036854775807n)throw problem(400,'ID 无效');return v}
export const codes=v=>{if(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string'||!x||x.length>100)||new Set(v).size!==v.length)throw problem(400,'编码列表无效');return v}
