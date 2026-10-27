import { isIP } from 'node:net'
import { ApiError, conflict, invalid, missing } from './errors.js'
import { ANNOUNCEMENT_TYPES, MODULES, RESULTS, announcementInput, choice, eventKey, hash, id, instant,
  integer, notificationInput, object, pagination, string, timeRange } from './validation.js'

const active = (row, now) => !row.invalidated_at && (!row.expires_at || row.expires_at > now)
const visibleAnnouncement = (row, now) => row?.status === 'PUBLISHED' && row.published_at <= now && (!row.expires_at || row.expires_at > now)
const cleanLog = ({ payload_hash, ...row }) => row
const messageView = (row, now) => ({ ...row, is_read: Boolean(row.read_at), is_active: active(row, now) })

export class D3Service {
  constructor(store, clock = () => new Date()) { this.store = store; this.clock = clock }
  now() { return this.clock().toISOString() }

  auditRecord(ctx, action, targetType, targetId, result = 'SUCCESS', reason = null) {
    const now = this.now()
    const record = {
      user_id: ctx.user?.id || null, module: 'D3', source_event_id: null,
      actor_type: ctx.user ? 'USER' : ctx.service ? 'SERVICE' : 'SYSTEM',
      action, target_type: targetType, target_id: targetId, request_method: ctx.method || null,
      request_path: ctx.path || null, result, ip_address: ctx.ip || null,
      reason, trace_id: ctx.requestId, occurred_at: now, created_at: now
    }
    return { ...record, payload_hash: hash(record) }
  }
  async failureAudit(ctx, error) {
    await this.store.transaction(tx => tx.appendLog(this.auditRecord(ctx, 'HTTP_REQUEST_REJECTED', null, null,
      [401, 403].includes(error.status) ? 'DENIED' : 'FAILURE', error.code)))
  }

  async notify(body, ctx) {
    const now = this.now()
    const input = notificationInput(body, ctx.service.module, now)
    const { recipient_user_ids, ...notification } = input
    return this.store.transaction(async tx => {
      const { created, record } = await tx.receiveNotification({ ...notification, created_at: now, invalidated_at: null })
      if (record.payload_hash !== input.payload_hash) throw conflict()
      if (created) {
        await tx.insertRecipients(record.id, recipient_user_ids, now)
        await tx.appendLog(this.auditRecord(ctx, 'NOTIFICATION_ACCEPT', 'NOTIFICATION', record.id, 'SUCCESS', `source_module=${ctx.service.module}`))
      }
      return { created, data: { id: record.id, deduplicated: !created, recipient_count: recipient_user_ids.length,
        channel: 'IN_APP', delivery_status: 'STORED', is_active: active(record, now) } }
    })
  }

  async invalidate(notificationId, body, ctx) {
    id(notificationId)
    object(body, [])
    return this.store.transaction(async tx => {
      let record = await tx.getNotification(notificationId)
      if (!record || record.source_module !== ctx.service.module) throw missing()
      if (!record.invalidated_at) {
        record = await tx.invalidateNotification(notificationId, this.now())
        await tx.appendLog(this.auditRecord(ctx, 'NOTIFICATION_INVALIDATE', 'NOTIFICATION', notificationId))
      }
      return { id: record.id, invalidated_at: record.invalidated_at }
    })
  }

  async listMessages(query, ctx) {
    const filters = pagination(query, ['is_read', 'source_module'])
    if (query.is_read !== undefined) filters.is_read = choice(query.is_read, 'is_read', ['true', 'false']) === 'true'
    if (query.source_module !== undefined) filters.source_module = choice(query.source_module, 'source_module', MODULES)
    const now = this.now()
    const result = await this.store.transaction(tx => tx.listMessages(ctx.user.id, filters))
    return { ...result, items: result.items.map(row => messageView(row, now)) }
  }
  async unread(ctx) { return { unread_count: await this.store.transaction(tx => tx.unreadCount(ctx.user.id, this.now())) } }
  async getMessage(messageId, ctx, read = false) {
    id(messageId)
    return this.store.transaction(async tx => {
      let record = await tx.getMessage(ctx.user.id, messageId)
      if (!record) throw missing()
      if (read && !record.read_at) {
        record = await tx.markRead(ctx.user.id, messageId, this.now())
        await tx.appendLog(this.auditRecord(ctx, 'MESSAGE_READ', 'MESSAGE', messageId))
      }
      return messageView(record, this.now())
    })
  }

  async listAnnouncements(query, admin = false) {
    const filters = pagination(query, ['type', ...(admin ? ['status', 'published_from', 'published_to'] : [])])
    if (query.type !== undefined) filters.type = choice(query.type, 'type', ANNOUNCEMENT_TYPES)
    if (admin) {
      if (query.status !== undefined) filters.status = choice(query.status, 'status', ['DRAFT', 'PUBLISHED', 'WITHDRAWN'])
      Object.assign(filters, timeRange(query, 'published_from', 'published_to'))
    }
    return this.store.transaction(tx => tx.listAnnouncements({ ...filters, public: !admin, now: this.now() }))
  }
  async getAnnouncement(announcementId, admin = false) {
    id(announcementId)
    const record = await this.store.transaction(tx => tx.getAnnouncement(announcementId))
    if (!record || (!admin && !visibleAnnouncement(record, this.now()))) throw missing()
    return record
  }
  async createAnnouncement(body, ctx) {
    const input = announcementInput(body)
    const now = this.now()
    if (input.expires_at && input.expires_at <= now) throw invalid('expires_at 必须晚于当前时间')
    return this.store.transaction(async tx => {
      const record = await tx.insertAnnouncement({ ...input, publisher_id: ctx.user.id, created_by: ctx.user.id,
        updated_by: ctx.user.id, status: 'DRAFT', published_at: null, withdrawn_at: null, created_at: now, updated_at: now, version: 1 })
      await tx.appendLog(this.auditRecord(ctx, 'ANNOUNCEMENT_CREATE', 'ANNOUNCEMENT', record.id))
      return record
    })
  }
  async changeAnnouncement(announcementId, body, ctx, action) {
    id(announcementId)
    object(body, action === 'EDIT' ? ['title', 'content', 'type', 'expires_at', 'expected_version'] : ['expected_version'])
    const expected = integer(body.expected_version, 'expected_version', 1, 2147483646)
    const patch = action === 'EDIT' ? announcementInput(body, true) : {}
    return this.store.transaction(async tx => {
      const record = await tx.getAnnouncement(announcementId)
      if (!record) throw missing()
      if (record.version !== expected) throw conflict('公告已被修改，请重新读取最新 version')
      const now = this.now()
      const changes = { ...patch, updated_at: now, updated_by: ctx.user.id, version: record.version + 1 }
      if (action === 'EDIT') {
        if (record.status === 'PUBLISHED') throw new ApiError(409, 'INVALID_STATE', '已发布公告须先撤回再修改')
        if (patch.expires_at && patch.expires_at <= now) throw invalid('expires_at 必须晚于当前时间')
      } else if (action === 'PUBLISH') {
        if (record.status === 'PUBLISHED') throw new ApiError(409, 'INVALID_STATE', '公告已经发布')
        if (record.expires_at && record.expires_at <= now) throw new ApiError(422, 'ANNOUNCEMENT_EXPIRED', '公告已过期，请先调整有效期')
        Object.assign(changes, { status: 'PUBLISHED', published_at: now, publisher_id: ctx.user.id, withdrawn_at: null })
      } else {
        if (record.status !== 'PUBLISHED') throw new ApiError(409, 'INVALID_STATE', '只能撤回已发布公告')
        Object.assign(changes, { status: 'WITHDRAWN', withdrawn_at: now })
      }
      const updated = await tx.updateAnnouncement(announcementId, changes)
      await tx.appendLog(this.auditRecord(ctx, `ANNOUNCEMENT_${action}`, 'ANNOUNCEMENT', announcementId))
      return updated
    })
  }

  async writeLog(body, ctx) {
    object(body, ['user_id', 'module', 'source_event_id', 'actor_type', 'action', 'target_type', 'target_id',
      'request_method', 'request_path', 'result', 'ip_address', 'occurred_at', 'trace_id', 'reason'])
    if (body.module !== undefined && body.module !== ctx.service.module) throw new ApiError(403, 'FORBIDDEN', '日志 module 必须与服务身份一致')
    const userId = id(body.user_id, 'user_id', true)
    const actor = choice(body.actor_type ?? (userId ? 'USER' : 'SYSTEM'), 'actor_type', ['USER', 'SYSTEM', 'SERVICE'])
    if ((actor === 'USER') !== Boolean(userId)) throw invalid('USER 必须有 user_id，SYSTEM/SERVICE 不应填写 user_id')
    const path = string(body.request_path, 'request_path', 255, true)
    if (path && !/^\/[^?#\s]*$/.test(path)) throw invalid('request_path 必须是路径，不得包含查询参数、片段或空白')
    const ip = string(body.ip_address, 'ip_address', 45, true)
    if (ip && !isIP(ip)) throw invalid('ip_address 格式不正确')
    const now = this.now()
    const data = {
      user_id: userId, module: ctx.service.module, source_event_id: eventKey(body.source_event_id, true), actor_type: actor,
      action: string(body.action, 'action', 100), target_type: string(body.target_type, 'target_type', 50, true),
      target_id: id(body.target_id, 'target_id', true), request_method: body.request_method == null ? null :
        choice(body.request_method, 'request_method', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
      request_path: path, result: choice(body.result, 'result', RESULTS), ip_address: ip,
      reason: string(body.reason, 'reason', 1000, true), occurred_at: instant(body.occurred_at, 'occurred_at', true)
    }
    if (data.target_id && !data.target_type) throw invalid('填写 target_id 时必须填写 target_type')
    if (data.occurred_at && Date.parse(data.occurred_at) > Date.parse(now) + 300000) throw invalid('occurred_at 不能超过当前时间 5 分钟')
    const trace = string(body.trace_id, 'trace_id', 64, true)
    return this.store.transaction(async tx => {
      const payload_hash = hash(data)
      const { created, record } = await tx.appendLog({ ...data, occurred_at: data.occurred_at || now, created_at: now, trace_id: trace, payload_hash })
      if (record.payload_hash !== payload_hash) throw conflict()
      return { created, data: { id: record.id, deduplicated: !created } }
    })
  }
  async listLogs(query) {
    const filters = pagination(query, ['user_id', 'module', 'action', 'result', 'start_time', 'end_time'])
    filters.user_id = id(query.user_id, 'user_id', true)
    filters.action = string(query.action, 'action', 100, true)
    if (query.module !== undefined) filters.module = choice(query.module, 'module', MODULES)
    if (query.result !== undefined) filters.result = choice(query.result, 'result', RESULTS)
    Object.assign(filters, timeRange(query, 'start_time', 'end_time'))
    const result = await this.store.transaction(tx => tx.listLogs(filters))
    return { ...result, items: result.items.map(cleanLog) }
  }
}
