import { auditPayload, enqueueAudit } from './audit.js'
import { occupancyTransaction } from './occupancy.js'
import { databaseNow } from './time.js'

export async function expireBatch(pool) {
  const [candidates] = await pool.query(`SELECT id, classroom_id FROM resource_reservations
    WHERE status = 'HELD' AND hold_expires_at <= UTC_TIMESTAMP(3) ORDER BY hold_expires_at, id LIMIT 100`)
  let expired = 0
  for (const candidate of candidates) {
    expired += await occupancyTransaction(pool, async connection => {
      await connection.query('SELECT id FROM classrooms WHERE id = ? FOR UPDATE', [candidate.classroom_id])
      const [[row]] = await connection.query('SELECT status, hold_expires_at FROM resource_reservations WHERE id = ? FOR UPDATE', [candidate.id])
      if (!row || row.status !== 'HELD' || row.hold_expires_at > await databaseNow(connection)) return 0
      await connection.query("UPDATE resource_reservations SET status = 'RELEASED' WHERE id = ?", [candidate.id])
      await enqueueAudit(connection, auditPayload({ action: 'RESERVATION_EXPIRE', targetType: 'RESERVATION',
        targetId: String(candidate.id), userId: null, method: 'SYSTEM', path: '/api/d2/reservations', ip: null }, 'SUCCESS'))
      return 1
    })
  }
  return expired
}

export function startExpiryWorker({ pool, pollMs = 5000, report = console.error }) {
  let stopped = false, timer, active
  async function tick() {
    try { await expireBatch(pool) } catch { report(JSON.stringify({ module: 'D2', event: 'EXPIRY_WORKER_UNAVAILABLE' })) }
    finally {
      if (!stopped) {
        timer = setTimeout(() => { active = tick() }, pollMs)
        timer.unref()
      }
    }
  }
  active = tick()
  return async () => { stopped = true; clearTimeout(timer); await active }
}
