const copy = value => structuredClone(value)
const newest = (a, b) => b.created_at.localeCompare(a.created_at) || (BigInt(a.id) > BigInt(b.id) ? -1 : 1)
const active = (row, now) => !row.invalidated_at && (!row.expires_at || row.expires_at > now)
const publicAnnouncement = (row, now) => row.status === 'PUBLISHED' && row.published_at <= now && (!row.expires_at || row.expires_at > now)

function page(rows, filters) {
  rows.sort(newest)
  const offset = (filters.page - 1) * filters.page_size
  return { items: copy(rows.slice(offset, offset + filters.page_size)), total: rows.length, page: filters.page, page_size: filters.page_size }
}

class MemoryTransaction {
  constructor(state) { this.state = state }
  insert(table, data) {
    const id = String(++this.state.counters[table])
    const row = { id, ...copy(data) }
    this.state[table].push(row)
    return copy(row)
  }
  async receiveNotification(data) {
    const old = this.state.notifications.find(row => row.source_module === data.source_module && row.source_event_id === data.source_event_id && row.notification_type === data.notification_type)
    return old ? { created: false, record: copy(old) } : { created: true, record: this.insert('notifications', data) }
  }
  async insertRecipients(notificationId, users, now) {
    for (const recipient_user_id of users) this.insert('recipients', { notification_id: notificationId, recipient_user_id, created_at: now, read_at: null })
  }
  async getNotification(id) { return copy(this.state.notifications.find(row => row.id === id) || null) }
  async invalidateNotification(id, now) {
    const row = this.state.notifications.find(row => row.id === id)
    row.invalidated_at ??= now
    return copy(row)
  }
  messages(userId) {
    return this.state.recipients.filter(row => row.recipient_user_id === userId).map(recipient => {
      const notification = this.state.notifications.find(row => row.id === recipient.notification_id)
      const { payload_hash, ...visible } = notification
      return { ...visible, ...recipient }
    })
  }
  async listMessages(userId, filters) {
    return page(this.messages(userId).filter(row =>
      (filters.is_read === undefined || Boolean(row.read_at) === filters.is_read) &&
      (!filters.source_module || row.source_module === filters.source_module)), filters)
  }
  async getMessage(userId, id) { return copy(this.messages(userId).find(row => row.id === id) || null) }
  async markRead(userId, id, now) {
    const row = this.state.recipients.find(row => row.id === id && row.recipient_user_id === userId)
    row.read_at ??= now
    return this.getMessage(userId, id)
  }
  async unreadCount(userId, now) { return this.messages(userId).filter(row => !row.read_at && active(row, now)).length }
  async insertAnnouncement(data) { return this.insert('announcements', data) }
  async getAnnouncement(id) { return copy(this.state.announcements.find(row => row.id === id) || null) }
  async updateAnnouncement(id, changes) {
    const row = this.state.announcements.find(row => row.id === id)
    Object.assign(row, copy(changes))
    return copy(row)
  }
  async listAnnouncements(filters) {
    return page(this.state.announcements.filter(row =>
      (!filters.public || publicAnnouncement(row, filters.now)) &&
      (!filters.status || row.status === filters.status) && (!filters.type || row.type === filters.type) &&
      (!filters.published_from || (row.published_at && row.published_at >= filters.published_from)) &&
      (!filters.published_to || (row.published_at && row.published_at < filters.published_to))), filters)
  }
  async appendLog(data) {
    const old = data.source_event_id && this.state.logs.find(row => row.module === data.module && row.source_event_id === data.source_event_id)
    return old ? { created: false, record: copy(old) } : { created: true, record: this.insert('logs', data) }
  }
  async listLogs(filters) {
    return page(this.state.logs.filter(row =>
      ['user_id', 'module', 'action', 'result'].every(key => !filters[key] || row[key] === filters[key]) &&
      (!filters.start_time || row.created_at >= filters.start_time) && (!filters.end_time || row.created_at < filters.end_time)), filters)
  }
}

// Mock 仅替换存储；业务校验、权限和事务内的处理仍走同一份服务代码。
export class MemoryStore {
  constructor() {
    this.state = { notifications: [], recipients: [], announcements: [], logs: [], counters: { notifications: 0n, recipients: 0n, announcements: 0n, logs: 0n } }
    this.tail = Promise.resolve()
    this.kind = 'memory'
  }
  async transaction(work) {
    const previous = this.tail
    let release
    this.tail = new Promise(resolve => { release = resolve })
    await previous
    const nextState = copy(this.state)
    try {
      const result = await work(new MemoryTransaction(nextState))
      this.state = nextState
      return result
    } finally { release() }
  }
  async check() {}
  async close() {}
}
