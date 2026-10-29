import { requireService } from './auth.js'
import { auditPayload, enqueueAudit } from './audit.js'
import { ApiError } from './errors.js'
import { loadResource, occupancyTransaction } from './occupancy.js'

export function createMaintenanceService(pool) {
  return async (data, identity, context) => {
    requireService(identity, ['M3'])
    return occupancyTransaction(pool, async connection => {
      const { parent } = await loadResource(connection, 'CLASSROOM', data.classroom_id, true)
      const [rows] = await connection.query('SELECT classroom_id, active, revision FROM maintenance_blocks WHERE ticket_id = ? FOR UPDATE', [data.ticket_id])
      const row = rows[0]
      if (row && (String(row.classroom_id) !== data.classroom_id || (row.revision === data.revision && Boolean(row.active) !== data.active))) {
        throw new ApiError(409, 'INVALID_STATE', '维修工单教室不可变更，同版本内容必须一致')
      }
      if (!row) {
        await connection.query('INSERT INTO maintenance_blocks (ticket_id, classroom_id, active, revision) VALUES (?, ?, ?, ?)',
          [data.ticket_id, data.classroom_id, data.active, data.revision])
      } else if (data.revision > row.revision) {
        await connection.query('UPDATE maintenance_blocks SET active = ?, revision = ?, updated_at = UTC_TIMESTAMP(3) WHERE ticket_id = ?',
          [data.active, data.revision, data.ticket_id])
      }
      const [blocks] = await connection.query('SELECT ticket_id FROM maintenance_blocks WHERE classroom_id = ? AND active = 1 FOR UPDATE', [data.classroom_id])
      await enqueueAudit(connection, auditPayload(context, 'SUCCESS', data.ticket_id))
      return { classroom_id: data.classroom_id, maintenance_blocked: parent.status === 'MAINTENANCE' || blocks.length > 0 }
    })
  }
}
