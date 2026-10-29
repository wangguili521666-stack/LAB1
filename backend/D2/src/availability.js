import { transaction } from './db.js'
import { availability, loadResource } from './occupancy.js'
import { databaseNow } from './time.js'

export function createAvailabilityService(pool, offset = 480) {
  return {
    check: data => transaction(pool, async connection => {
      const resource = await loadResource(connection, data.resource_type, data.resource_id)
      return availability(connection, resource, data, await databaseNow(connection), offset)
    }),
    search: data => transaction(pool, async connection => {
      const seat = data.resource_type === 'SEAT'
      const clauses = [], args = []
      for (const [key, value] of Object.entries(data.filters)) {
        const column = key === 'classroom_id' ? 'c.id' : key === 'socket_type' ? 's.socket_type' : `c.${key === 'min_capacity' ? 'capacity' : key}`
        clauses.push(`${column} ${key === 'min_capacity' ? '>=' : '='} ?`)
        args.push(value)
      }
      const [rows] = await connection.query(`SELECT ${seat ? 's' : 'c'}.id FROM classrooms c
        ${seat ? 'JOIN seats s ON s.classroom_id = c.id' : ''}
        ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY ${seat ? 's' : 'c'}.id`, args)
      const now = await databaseNow(connection)
      const result = []
      for (const row of rows) {
        const input = { ...data, resource_id: String(row.id) }
        result.push(await availability(connection, await loadResource(connection, data.resource_type, input.resource_id), input, now, offset))
      }
      return result
    })
  }
}
