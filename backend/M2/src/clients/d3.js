import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { getPool } from '../db.js'
import { serviceRequest } from './http.js'

// Business transitions pass their connection so audit intent commits atomically.
export async function writeLog(entry, executor = getPool()) {
  const payload = {
    source_event_id: randomUUID(), occurred_at: new Date().toISOString(),
    user_id: entry.userId == null ? null : String(entry.userId), module: 'M2',
    action: entry.action, target_type: 'CLASSROOM_APPLICATION',
    target_id: entry.targetId == null ? null : String(entry.targetId),
    request_method: entry.method || null, request_path: entry.path || null,
    result: entry.result, ip_address: entry.ip || null,
  }
  await executor.query('INSERT INTO m2_audit_outbox(payload) VALUES (?)', [JSON.stringify(payload)])
}
let busy = false
export async function deliverLogs() {
  if (busy) return
  busy = true
  try {
    const [rows] = await getPool().query('SELECT id,payload FROM m2_audit_outbox WHERE sent=0 ORDER BY id LIMIT 30')
    for (const row of rows) {
      try {
        await serviceRequest(config.d3BaseUrl, '/api/d3/internal/logs', {
          method: 'POST', service: 'd3',
          body: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
          timeout: config.auditTimeoutMs,
        })
        await getPool().query('UPDATE m2_audit_outbox SET sent=1 WHERE id=?', [row.id])
      } catch { console.error('M2_AUDIT_RETRY'); break }
    }
  } finally { busy = false }
}
