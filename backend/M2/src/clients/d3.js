import { config } from '../config.js'
import { serviceRequest } from './http.js'

export async function writeLog(entry) {
  const payload = {
    user_id: entry.userId == null ? null : String(entry.userId),
    module: 'M2',
    action: entry.action,
    target_type: 'CLASSROOM_APPLICATION',
    target_id: entry.targetId == null ? null : String(entry.targetId),
    request_method: entry.method || null,
    request_path: entry.path || null,
    result: entry.result,
    ip_address: entry.ip || null,
  }
  try {
    await serviceRequest(config.d3BaseUrl, '/api/d3/internal/logs', {
      method: 'POST',
      service: 'd3',
      body: payload,
      timeout: config.auditTimeoutMs,
    })
  } catch (err) {
    console.error('审计日志写入失败：', err.message)
  }
}
