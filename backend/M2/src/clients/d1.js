import { config } from '../config.js'
import { serviceRequest } from './http.js'
import { HttpError } from '../utils/httpError.js'

function permissionMessage(reason) {
  if (reason === 'COLLEGE_MISMATCH') return '没有该学院教室的申请权限'
  if (reason === 'ACCOUNT_DISABLED') return '账号已禁用'
  return '权限不足'
}

export async function authorize({ userId, permissionCode, resourceCollegeId }) {
  const body = { user_id: String(userId), permission_code: permissionCode }
  if (resourceCollegeId !== undefined && resourceCollegeId !== null && resourceCollegeId !== '') {
    body.resource_college_id = String(resourceCollegeId)
  }
  const data = await serviceRequest(config.d1BaseUrl, '/api/d1/internal/authorize', {
    method: 'POST',
    body,
  })
  return { allowed: Boolean(data?.allowed), reason: data?.reason || null }
}

export async function hasPermission(args) {
  const result = await authorize(args)
  return result.allowed
}

export async function requirePermission(args) {
  const result = await authorize(args)
  if (!result.allowed) throw new HttpError(403, 'FORBIDDEN', permissionMessage(result.reason))
}
