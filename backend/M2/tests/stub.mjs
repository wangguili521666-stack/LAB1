import express from 'express'

export async function startStub(token) {
  const classrooms = new Map([
    ['201', room('201', '1')],
    ['202', room('202', null, { room_number: '101', capacity: 40 })],
    ['203', room('203', '1', { status: 'MAINTENANCE', room_number: '102' })],
    ['204', room('204', '1', { is_bookable_whole: false, room_number: '103' })],
    ['205', room('205', '2', { building: '教学楼B', room_number: '201', capacity: 30 })],
  ])
  const users = {
    1: { permissions: new Set(), college_id: '1' },
    2: { permissions: new Set(['classroom:apply']), college_id: '1' },
    3: { permissions: new Set(['classroom:apply']), college_id: '2' },
    4: { permissions: new Set(['classroom:approve_l1']), college_id: null },
    5: { permissions: new Set(['classroom:approve_l2']), college_id: null },
  }
  const reservations = []
  const logs = []
  let seq = 1
  let chain = Promise.resolve()

  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    if (req.get('x-service-token') !== token) {
      return res.status(401).json(envelope('UNAUTHORIZED', '服务身份无效'))
    }
    next()
  })

  app.post('/api/d1/internal/authorize', (req, res) => {
    const user = users[req.body?.user_id]
    if (!user?.permissions.has(req.body?.permission_code)) {
      return res.json(envelope('OK', 'success', { allowed: false, reason: 'PERMISSION_DENIED' }))
    }
    const resourceCollege = req.body?.resource_college_id
    if (resourceCollege && user.college_id && String(resourceCollege) !== String(user.college_id)) {
      return res.json(envelope('OK', 'success', { allowed: false, reason: 'COLLEGE_MISMATCH' }))
    }
    res.json(envelope('OK', 'success', { allowed: true, reason: null }))
  })

  app.get('/api/d2/classrooms', (req, res) => {
    let items = [...classrooms.values()]
    const { college_id: collegeId, building, room_number: roomNumber, status, min_capacity: minCapacity } = req.query
    if (collegeId) items = items.filter((item) => String(item.college_id) === String(collegeId))
    if (building) items = items.filter((item) => item.building === building)
    if (roomNumber) items = items.filter((item) => item.room_number === roomNumber)
    if (status) items = items.filter((item) => item.status === status)
    if (req.query.is_bookable_whole === 'true') items = items.filter((item) => item.is_bookable_whole)
    if (minCapacity !== undefined && minCapacity !== '') {
      items = items.filter((item) => item.capacity >= Number(minCapacity))
    }
    res.json(envelope('OK', 'success', { items, page: 1, page_size: 100, total: items.length }))
  })

  app.get('/api/d2/classrooms/:id', (req, res) => {
    const classroom = classrooms.get(req.params.id)
    if (!classroom) return res.status(404).json(envelope('NOT_FOUND', '教室不存在'))
    res.json(envelope('OK', 'success', classroom))
  })

  app.post('/api/d2/availability/search', (req, res) => {
    const { start_time: start, end_time: end, filters = {} } = req.body || {}
    const data = [...classrooms.values()]
      .filter((item) => !filters.college_id || String(item.college_id) === String(filters.college_id))
      .filter((item) => !filters.building || item.building === filters.building)
      .filter((item) => !filters.room_number || item.room_number === filters.room_number)
      .filter((item) => filters.min_capacity == null || item.capacity >= Number(filters.min_capacity))
      .map((item) => ({
        resource_type: 'CLASSROOM',
        resource_id: item.id,
        classroom_id: item.id,
        available: item.status === 'AVAILABLE' && item.is_bookable_whole && !reserved(item.id, start, end),
        reason: null,
      }))
    res.json(envelope('OK', 'success', data))
  })

  app.post('/api/d2/reservations', (req, res) => {
    chain = chain.then(() => {
      const body = req.body || {}
      const classroom = classrooms.get(String(body.resource_id))
      if (!classroom || classroom.status !== 'AVAILABLE' || !classroom.is_bookable_whole) {
        return res.status(422).json(envelope('VALIDATION_ERROR', '教室不可预约'))
      }
      if (reserved(body.resource_id, body.start_time, body.end_time)) {
        return res.status(409).json(envelope('RESOURCE_CONFLICT', '该教室已有重叠的资源占用'))
      }
      const created = {
        id: String(seq++),
        ...body,
        classroom_id: String(body.resource_id),
        status: 'HELD',
      }
      reservations.push(created)
      res.status(201).json(envelope('OK', 'success', created))
    })
  })

  app.post('/api/d2/reservations/:id/confirm', (req, res) => {
    const found = reservations.find((item) => item.id === req.params.id)
    if (!found) return res.status(404).json(envelope('NOT_FOUND', '预占不存在'))
    if (found.status !== 'HELD') return res.status(409).json(envelope('INVALID_STATE', '预占状态不可确认'))
    found.status = 'CONFIRMED'
    found.hold_expires_at = null
    res.json(envelope('OK', 'success', found))
  })

  app.post('/api/d2/reservations/:id/release', (req, res) => {
    const found = reservations.find((item) => item.id === req.params.id)
    if (!found) return res.status(404).json(envelope('NOT_FOUND', '预占不存在'))
    if (found.status === 'RELEASED') return res.status(409).json(envelope('INVALID_STATE', '预占已释放'))
    found.status = 'RELEASED'
    res.json(envelope('OK', 'success', found))
  })

  app.get('/api/d2/reservations/:id', (req, res) => {
    const found = reservations.find((item) => item.id === req.params.id)
    if (!found) return res.status(404).json(envelope('NOT_FOUND', '预占不存在'))
    res.json(envelope('OK', 'success', found))
  })

  app.get('/api/d2/reservations', (req, res) => {
    const items = reservations.filter((item) => {
      if (req.query.source_module && item.source_module !== req.query.source_module) return false
      if (req.query.source_id && String(item.source_id) !== String(req.query.source_id)) return false
      return true
    })
    res.json(envelope('OK', 'success', { items, page: 1, page_size: 20, total: items.length }))
  })

  app.post('/api/d3/internal/logs', (req, res) => {
    logs.push(req.body)
    res.status(201).json(envelope('OK', 'success', { id: String(logs.length) }))
  })

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    logs,
    reservations,
    occupy(classroomId, start, end) {
      reservations.push({
        id: String(seq++),
        resource_type: 'CLASSROOM',
        resource_id: String(classroomId),
        classroom_id: String(classroomId),
        source_module: 'M1',
        source_id: '1',
        start_time: start,
        end_time: end,
        status: 'CONFIRMED',
        hold_expires_at: null,
      })
    },
    reset() {
      reservations.splice(0, reservations.length)
      logs.splice(0, logs.length)
    },
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }

  function reserved(resourceId, start, end) {
    return reservations.some((item) => {
      if (String(item.resource_id) !== String(resourceId)) return false
      if (item.status === 'RELEASED') return false
      if (item.status === 'HELD' && item.hold_expires_at && new Date(item.hold_expires_at) <= new Date()) return false
      if (item.status !== 'HELD' && item.status !== 'CONFIRMED') return false
      return new Date(start) < new Date(item.end_time) && new Date(item.start_time) < new Date(end)
    })
  }
}

function room(id, collegeId, extra = {}) {
  return {
    id,
    building: '教学楼A',
    room_number: '301',
    college_id: collegeId,
    capacity: 80,
    equipment: { projector: true },
    status: 'AVAILABLE',
    is_bookable_whole: true,
    open_time: '08:00:00',
    close_time: '22:00:00',
    ...extra,
  }
}

function envelope(code, message, data = null) {
  return { code, message, data, request_id: 'stub' }
}
