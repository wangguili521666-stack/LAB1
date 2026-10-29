import { bearer } from '../src/auth.js'
import { ApiError } from '../src/errors.js'

// 公开的假凭据，仅供本机 Mock 与测试；src/index.js 不导入本文件。
export const mockServiceTokens = Object.fromEntries(['M1', 'M2', 'M3', 'D1', 'D2'].map(module => [module, `mock-${module.toLowerCase()}-local-only`]))
export const mockUsers = {
  'mock-student-101': { id: '101', roles: ['STUDENT'] },
  'mock-student-102': { id: '102', roles: ['STUDENT'] },
  'mock-operator-103': { id: '103', roles: ['OPERATION_ADMIN'], permissions: ['announcement:manage'] },
  'mock-admin-104': { id: '104', roles: ['SYSTEM_ADMIN'] }
}
export async function mockAuthenticate(header) {
  const user = mockUsers[bearer(header)]
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Mock 令牌无效')
  return structuredClone(user)
}
