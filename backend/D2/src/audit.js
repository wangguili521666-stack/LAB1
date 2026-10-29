import { transaction } from './db.js'

export function auditPayload(context, result, targetId = context.targetId) {
  return {
    user_id: context.userId || null,
    module: 'D2',
    action: context.action,
    target_type: context.targetType,
    target_id: targetId || null,
    request_method: context.method,
    request_path: context.path,
    result,
    ip_address: context.ip
  }
}

export async function enqueueAudit(connection, payload) {
  await connection.query('INSERT INTO operation_log_outbox (payload) VALUES (?)', [JSON.stringify(payload)])
}

export async function deliverOne(pool, send) {
  return transaction(pool, async connection => {
    const [rows] = await connection.query(
      `SELECT id, payload, attempts FROM operation_log_outbox
       WHERE status = 'PENDING' AND next_attempt_at <= UTC_TIMESTAMP()
       ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`
    )
    if (!rows.length) return false
    const row = rows[0]
    try {
      await send(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)
    } catch {
      const delay = Math.min(300, 2 ** Math.min(row.attempts + 1, 8))
      await connection.query(
        `UPDATE operation_log_outbox SET attempts = attempts + 1,
         next_attempt_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP()), last_error_code = 'DEPENDENCY_UNAVAILABLE'
         WHERE id = ?`, [delay, row.id]
      )
      return true
    }
    await connection.query(
      `UPDATE operation_log_outbox SET status = 'SENT', attempts = attempts + 1,
       sent_at = UTC_TIMESTAMP(), last_error_code = NULL WHERE id = ?`, [row.id]
    )
    return true
  })
}

export function startAuditWorker({ pool, send, pollMs, report = console.error }) {
  let stopped = false
  let timer
  let active = Promise.resolve()
  async function tick() {
    try {
      for (let i = 0; i < 20 && !stopped; i++) if (!await deliverOne(pool, send)) break
    } catch {
      report(JSON.stringify({ module: 'D2', event: 'AUDIT_WORKER_UNAVAILABLE' }))
    } finally {
      if (!stopped) {
        timer = setTimeout(() => { active = tick() }, pollMs)
        timer.unref()
      }
    }
  }
  active = tick()
  return async () => {
    stopped = true
    clearTimeout(timer)
    await active
  }
}
