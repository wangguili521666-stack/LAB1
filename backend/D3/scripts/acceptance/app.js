const $ = id => document.getElementById(id)
const state = { key: null, busy: false, ready: false, counts: null, notification: null, editing: null,
  pages: { messages: 1, announcements: 1, logs: 1 } }
const tableNames = { notifications: 'd3_notifications', messages: 'd3_notification_recipients', announcements: 'announcements', logs: 'operation_logs' }
const statusLabels = { DRAFT: '草稿', PUBLISHED: '已发布', WITHDRAWN: '已撤回', SUCCESS: '成功', FAILURE: '失败', DENIED: '权限拒绝' }
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const time = value => value ? dateFormat.format(new Date(value)) : '—'
function node(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}
function badge(text, tone = '') { return node('span', text, `pill ${tone}`) }
function lock(control, locked) { control.dataset.locked = String(locked); control.disabled = locked || state.busy || !state.ready }
function syncControls() {
  for (const control of document.querySelectorAll('button,input,select,textarea')) {
    control.disabled = state.busy || !state.ready || control.dataset.locked === 'true'
  }
  document.querySelector('main').setAttribute('aria-busy', String(state.busy))
}
function notice(message, tone = 'neutral') { $('notice').textContent = message; $('notice').className = `notice ${tone}` }
function showResponse(path, method, status, result) {
  $('response-status').textContent = `HTTP ${status} · ${result.code || '未知结果'}`
  $('response-json').textContent = JSON.stringify({ method, path, http_status: status, response: result }, null, 2)
}
async function localFetch(path, options = {}) {
  let response
  try { response = await fetch(`/local/d3/${path}`, { ...options, signal: AbortSignal.timeout(15000),
    headers: { 'X-D3-Local-Key': state.key || '', ...options.headers } }) }
  catch { throw new Error('无法连接本地 D3。写操作可能已生效，请先刷新列表核对；如果服务已关闭，请运行 npm.cmd run dev:local。') }
  let result
  try { result = await response.json() } catch { throw new Error('服务未返回有效结果，请确认打开的是本地 D3 验收页面。') }
  return { status: response.status, result }
}
function apiError(status, result) {
  const error = new Error(`${result.message || '操作失败'}（HTTP ${status} / ${result.code}）${result.request_id ? `\n请求编号：${result.request_id}` : ''}`)
  error.status = status
  error.code = result.code
  return error
}
async function api(path, { method = 'GET', actor = 'public', body, quiet = false } = {}) {
  const { status, result } = await localFetch('request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, method, path: `/api/d3${path}`, ...(body === undefined ? {} : { body }) }) })
  if (!quiet) showResponse(`/api/d3${path}`, method, status, result)
  if (status >= 400 || result.code !== 'OK') throw apiError(status, result)
  return result.data
}
async function refreshDatabase(showDelta = false) {
  try {
    const { status, result } = await localFetch('database')
    if (status >= 400) throw apiError(status, result)
    const data = result.data
    for (const [name, count] of Object.entries(data.counts)) {
      $(`count-${name}`).textContent = count
      const delta = state.counts ? BigInt(count) - BigInt(state.counts[name]) : 0n
      const changed = showDelta && delta !== 0n
      $(`delta-${name}`).textContent = changed ? `${delta > 0n ? '+' : ''}${delta} · 相比上次读取` : tableNames[name]
      $(`delta-${name}`).className = changed ? 'changed' : ''
    }
    state.counts = data.counts
    $('connection-status').textContent = 'MySQL 已连接'
    $('connection-status').className = 'status good'
    $('checked-at').textContent = `数据库读取于 ${time(data.checked_at)}`
  } catch (error) {
    $('connection-status').textContent = '数据库读取失败'
    $('connection-status').className = 'status bad'
    $('checked-at').textContent = '上方数字可能是上次结果，请重试'
    throw error
  }
}
function empty(container, message) { container.replaceChildren(node('div', message, 'empty')) }
function actionButton(text, action, disabled = false) {
  const button = node('button', text, 'secondary')
  button.type = 'button'
  button.addEventListener('click', action)
  lock(button, disabled)
  return button
}
function paginate(kind, data, load) {
  const container = $(`${kind}-pagination`)
  const last = Math.max(1, Math.ceil(data.total / data.page_size))
  container.replaceChildren(node('span', `共 ${data.total} 条 · 第 ${data.page} / ${last} 页`),
    actionButton('上一页', () => perform('读取上一页', async () => { state.pages[kind]--; await load(); return '列表已更新。' }, false), data.page <= 1),
    actionButton('下一页', () => perform('读取下一页', async () => { state.pages[kind]++; await load(); return '列表已更新。' }, false), data.page >= last))
}
function detail(title, data, content) {
  $('detail-title').textContent = title
  $('detail-content').replaceChildren(...(content === undefined ? [] : [node('p', content)]), node('pre', JSON.stringify(data, null, 2)))
  $('detail-dialog').showModal()
}
function switchTab(name) {
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== `panel-${name}`
  for (const item of document.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.tab === name)
    if (item.dataset.tab === name) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
}

async function loadMessages(quiet = true) {
  const actor = $('message-user').value
  const query = new URLSearchParams({ page: state.pages.messages, page_size: 8 })
  if ($('message-read').value) query.set('is_read', $('message-read').value)
  try {
    const [data, unread] = await Promise.all([api(`/messages/me?${query}`, { actor, quiet }), api('/messages/me/unread-count', { actor, quiet: true })])
    $('unread-count').textContent = unread.unread_count
    const list = $('messages-list')
    list.replaceChildren()
    if (!data.items.length) empty(list, '这个筛选条件下还没有消息。可先发送通知，或切换学生身份。')
    for (const message of data.items) {
      const row = node('article', undefined, 'record')
      const top = node('div', undefined, 'record-top')
      const badges = node('div', undefined, 'badges')
      badges.append(badge(message.is_read ? '已读' : '未读', message.is_read ? '' : 'green'),
        badge(message.is_active ? '有效' : message.invalidated_at ? '已失效' : '已过期', message.is_active ? '' : 'amber'))
      top.append(node('h4', message.title), badges)
      const buttons = node('div', undefined, 'button-row')
      buttons.append(actionButton('查看详情', () => perform('读取消息详情', async () => {
        const result = await api(`/messages/me/${message.id}`, { actor })
        detail(result.title, result, result.content)
        return '已读取详情，消息的已读状态未改变。'
      }, false)), actionButton(message.is_read ? '再次标记已读' : '标记已读', () => perform('标记消息已读', async () => {
        const result = await api(`/messages/me/${message.id}/read`, { method: 'POST', actor, body: {} })
        return message.read_at === result.read_at ? `重复已读成功，首次已读时间保持为 ${time(result.read_at)}。` : `消息 #${result.id} 已读，首次已读时间为 ${time(result.read_at)}。`
      })))
      row.append(top, node('p', message.content), node('div', `消息 #${message.id} · 通知 #${message.notification_id} · 来源 ${message.source_module} · 接收人 ${message.recipient_user_id}`, 'record-meta'),
        node('div', `创建 ${time(message.created_at)} · 首次已读 ${time(message.read_at)} · 过期 ${time(message.expires_at)}`, 'record-meta'), buttons)
      list.append(row)
    }
    paginate('messages', data, loadMessages)
  } catch (error) { empty($('messages-list'), '消息读取失败，请重试。'); $('messages-pagination').replaceChildren(); $('unread-count').textContent = '—'; throw error }
}

function localDatetime(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}
function setEditor(announcement = null) {
  state.editing = announcement
  if (!announcement) $('announcement-form').reset()
  else {
    $('announcement-title').value = announcement.title
    $('announcement-content').value = announcement.content
    $('announcement-type').value = announcement.type
    $('announcement-expiry').value = localDatetime(announcement.expires_at)
  }
  const published = announcement?.status === 'PUBLISHED'
  $('announcement-editor-title').textContent = announcement ? `编辑公告 #${announcement.id}` : '新建公告草稿'
  $('announcement-version').textContent = announcement ? `当前版本 ${announcement.version} · ${statusLabels[announcement.status]}${published ? ' · 请先撤回再修改' : ''}` : '保存草稿后，再从列表发布。'
  $('save-announcement').textContent = announcement ? '保存修改' : '保存新草稿'
  lock($('save-announcement'), published)
  for (const id of ['announcement-title', 'announcement-content', 'announcement-type', 'announcement-expiry']) lock($(id), published)
}
async function announcementAction(record, action) {
  return perform(action === 'publish' ? '发布公告' : '撤回公告', async () => {
    const result = await api(`/announcements/${record.id}/${action}`, { method: 'POST', actor: 'operator-103', body: { expected_version: record.version } })
    if (state.editing?.id === result.id) setEditor(result)
    return `公告 #${result.id} ${statusLabels[result.status]}，版本更新为 ${result.version}。`
  })
}
async function loadAnnouncements(quiet = true) {
  const query = new URLSearchParams({ page: state.pages.announcements, page_size: 5 })
  if ($('announcement-status').value) query.set('status', $('announcement-status').value)
  try {
    const data = await api(`/admin/announcements?${query}`, { actor: 'operator-103', quiet })
    const list = $('announcements-list')
    list.replaceChildren()
    if (!data.items.length) empty(list, '没有符合条件的公告。可以创建一条新草稿。')
    for (const record of data.items) {
      const row = node('article', undefined, 'record')
      const top = node('div', undefined, 'record-top')
      top.append(node('h4', record.title), badge(statusLabels[record.status], record.status === 'PUBLISHED' ? 'green' : ''))
      const buttons = node('div', undefined, 'button-row')
      buttons.append(actionButton(record.status === 'PUBLISHED' ? '查看内容' : '编辑', () => perform('读取公告', async () => {
        const result = await api(`/admin/announcements/${record.id}`, { actor: 'operator-103' })
        setEditor(result)
        return `已载入公告 #${result.id}，版本 ${result.version}。`
      }, false)), actionButton(record.status === 'PUBLISHED' ? '撤回' : '发布', () => announcementAction(record, record.status === 'PUBLISHED' ? 'withdraw' : 'publish')))
      row.append(top, node('p', record.content), node('div', `公告 #${record.id} · 版本 ${record.version} · ${record.type} · 过期 ${time(record.expires_at)}`, 'record-meta'), buttons)
      list.append(row)
    }
    paginate('announcements', data, loadAnnouncements)
  } catch (error) { empty($('announcements-list'), '公告读取失败，请重试。'); $('announcements-pagination').replaceChildren(); throw error }
}
async function loadPublic() {
  try {
    const data = await api('/announcements?page_size=5', { quiet: true })
    $('public-count').textContent = `公共接口当前共 ${data.total} 条有效公告，展示最新 5 条。`
    const list = $('public-announcements')
    list.replaceChildren()
    if (!data.items.length) empty(list, '暂无对普通用户可见的公告。')
    for (const record of data.items) {
      const row = node('article', undefined, 'record')
      row.append(node('h4', record.title), node('p', record.content), node('div', `公告 #${record.id} · 发布于 ${time(record.published_at)}`, 'record-meta'))
      list.append(row)
    }
  } catch (error) { empty($('public-announcements'), '公共公告读取失败，请重试。'); $('public-count').textContent = '读取失败'; throw error }
}
async function loadLogs(quiet = true) {
  const query = new URLSearchParams({ page: state.pages.logs, page_size: 10 })
  for (const [id, key] of [['log-module', 'module'], ['log-result', 'result'], ['log-action', 'action'], ['log-user', 'user_id']]) {
    if ($(id).value.trim()) query.set(key, $(id).value.trim())
  }
  for (const [id, key] of [['log-start', 'start_time'], ['log-end', 'end_time']]) if ($(id).value) query.set(key, new Date($(id).value).toISOString())
  try {
    const data = await api(`/admin/logs?${query}`, { actor: 'admin-104', quiet })
    const list = $('logs-list')
    list.replaceChildren()
    if (!data.items.length) { const row = node('tr'); const cell = node('td', '没有匹配的审计记录。'); cell.colSpan = 5; row.append(cell); list.append(row) }
    for (const record of data.items) {
      const row = node('tr')
      const date = node('td', `#${record.id}`); date.append(node('small', time(record.created_at)))
      const actor = node('td', record.module); actor.append(node('small', `${record.actor_type} ${record.user_id || ''}`))
      const action = node('td', record.action); action.append(node('small', `${record.target_type || '—'} ${record.target_id || ''}`))
      const result = node('td'); result.append(badge(statusLabels[record.result] || record.result, record.result === 'SUCCESS' ? 'green' : record.result === 'DENIED' ? 'amber' : 'red'))
      const details = node('td'); details.append(actionButton('详情', () => detail(`审计 #${record.id}`, record)))
      row.append(date, actor, action, result, details); list.append(row)
    }
    paginate('logs', data, loadLogs)
  } catch (error) { const row = node('tr'); const cell = node('td', '审计查询失败，请检查筛选条件后重试。'); cell.colSpan = 5; row.append(cell); $('logs-list').replaceChildren(row); $('logs-pagination').replaceChildren(); throw error }
}
async function refreshAll(showDelta = false) {
  const results = await Promise.allSettled([loadMessages(), loadAnnouncements(), loadPublic(), loadLogs()])
  // 等待所有接口读取结束后再读数据库，权限失败产生的审计也可被计入。
  try { await refreshDatabase(showDelta) } catch (error) { results.push({ status: 'rejected', reason: error }) }
  return results.filter(result => result.status === 'rejected').map(result => result.reason.message)
}
async function perform(label, action, refresh = true) {
  if (state.busy || !state.ready) return
  state.busy = true; syncControls(); notice(`${label}…`)
  try {
    const message = await action()
    const errors = refresh ? await refreshAll(true) : []
    notice(`${message || '操作完成。'}${errors.length ? `\n操作已完成，但部分数据刷新失败：${errors.join('；')}` : ''}`, errors.length ? 'warn' : 'good')
  } catch (error) {
    notice(error.message, 'bad')
    // 不自动重试写操作；仅刷新计数和审计，保留原始错误供排查。
    await Promise.allSettled([refreshDatabase(true), loadLogs()])
  } finally { state.busy = false; syncControls() }
}
function renderNotification(data, event, actor) {
  $('notification-result-title').textContent = `通知 #${data.id}${data.deduplicated ? ' · 已去重' : ' · 已接收'}${data.is_active === false ? ' · 已失效或过期' : ''}`
  $('notification-result').replaceChildren(node('p', event.title), node('div', `来源 ${actor} · 接收人 ${event.recipient_user_ids.join('、')} · 共 ${data.recipient_count} 人`),
    node('div', `事件编号：${event.source_event_id}`), node('div', `有效期至：${time(event.expires_at)}`))
  lock($('retry-notification'), false); lock($('invalidate-notification'), false)
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab))
$('close-detail').addEventListener('click', () => $('detail-dialog').close())
$('refresh-all').addEventListener('click', () => perform('刷新数据', async () => {
  const errors = await refreshAll()
  if (errors.length) throw new Error(errors.join('；'))
  return '全部数据已从接口和数据库重新读取。'
}, false))
$('notification-form').addEventListener('submit', event => {
  event.preventDefault()
  perform('发送通知', async () => {
    const recipients = [...document.querySelectorAll('input[name="recipient"]:checked')].map(input => input.value)
    if (!recipients.length) throw new Error('请至少选择一个接收学生。')
    const now = new Date()
    const notificationType = $('notify-type').value
    const body = { source_event_id: `acceptance:${crypto.randomUUID()}`, notification_type: notificationType,
      biz_type: { BOOKING_REMINDER: 'SEAT_BOOKING', APPROVAL_RESULT: 'CLASSROOM_APPLICATION', REPAIR_PROGRESS: 'REPAIR_TICKET', SYSTEM_NOTICE: 'SYSTEM' }[notificationType],
      biz_id: $('notify-biz').value.trim(), recipient_user_ids: recipients, title: $('notify-title').value.trim(), content: $('notify-content').value.trim(),
      occurred_at: now.toISOString(), channels: ['IN_APP'],
      ...($('notify-expiry').value ? { expires_at: new Date(now.getTime() + Number($('notify-expiry').value) * 60000).toISOString() } : {}) }
    const actor = $('notify-module').value
    // 在发出前保留完整事件，网络超时后仍可按同一事件重试。
    state.notification = { body, actor, result: null }
    $('notification-result-title').textContent = '正在提交本次通知'
    $('notification-result').textContent = `事件编号：${body.source_event_id}。若结果不确定，可原样重试，或刷新消息列表核对。`
    lock($('retry-notification'), false); lock($('invalidate-notification'), true)
    const result = await api('/internal/notifications', { method: 'POST', actor, body })
    state.notification.result = result
    renderNotification(result, body, actor)
    state.pages.messages = 1; state.pages.logs = 1
    return `通知 #${result.id} 已保存，生成 ${result.recipient_count} 条用户消息。可继续原样重试或查看个人消息。`
  })
})
$('retry-notification').addEventListener('click', () => perform('原样重试通知', async () => {
  const last = state.notification
  if (!last) throw new Error('请先发送一条通知。')
  const result = await api('/internal/notifications', { method: 'POST', actor: last.actor, body: last.body })
  if (last.result && result.id !== last.result.id) throw new Error('验收未通过：重复事件返回了不同的通知编号。')
  last.result = result; renderNotification(result, last.body, last.actor)
  return result.deduplicated ? `去重成功：仍为通知 #${result.id}，没有新增通知和收件记录。` : `通知 #${result.id} 首次保存成功；可再次原样重试检查去重。`
}))
$('invalidate-notification').addEventListener('click', () => perform('使通知失效', async () => {
  const last = state.notification
  if (!last?.result) throw new Error('还没有可失效的通知。')
  const result = await api(`/internal/notifications/${last.result.id}/invalidate`, { method: 'POST', actor: last.actor, body: {} })
  $('notification-result-title').textContent = `通知 #${result.id} · 已失效`
  return `通知 #${result.id} 已失效，时间 ${time(result.invalidated_at)}。消息历史保留，不再计入有效未读。`
}))
function queryMessages(event) {
  event?.preventDefault()
  perform('查询个人消息', async () => { state.pages.messages = 1; await loadMessages(false); return '个人消息已更新。' }, false)
}
$('messages-filter').addEventListener('submit', queryMessages)
$('message-user').addEventListener('change', queryMessages)
$('message-read').addEventListener('change', queryMessages)
$('new-announcement').addEventListener('click', () => { setEditor(); $('announcement-title').focus() })
$('announcement-form').addEventListener('submit', event => {
  event.preventDefault()
  perform('保存公告', async () => {
    const current = state.editing
    const body = { title: $('announcement-title').value.trim(), content: $('announcement-content').value.trim(), type: $('announcement-type').value,
      expires_at: $('announcement-expiry').value ? new Date($('announcement-expiry').value).toISOString() : null,
      ...(current ? { expected_version: current.version } : {}) }
    const result = await api(current ? `/announcements/${current.id}` : '/announcements', { method: current ? 'PATCH' : 'POST', actor: 'operator-103', body })
    setEditor(result); state.pages.announcements = 1; state.pages.logs = 1
    return `公告 #${result.id} 已保存，当前为${statusLabels[result.status]}，版本 ${result.version}。`
  })
})
$('announcements-filter').addEventListener('submit', event => {
  event.preventDefault()
  perform('查询公告', async () => { state.pages.announcements = 1; await loadAnnouncements(false); await loadPublic(); return '管理列表和公共公告已更新。' }, false)
})
$('logs-filter').addEventListener('submit', event => {
  event.preventDefault()
  perform('查询审计', async () => { state.pages.logs = 1; await loadLogs(false); return '审计记录已按筛选条件更新。' }, false)
})
$('reset-logs').addEventListener('click', () => perform('重置审计筛选', async () => { $('logs-filter').reset(); state.pages.logs = 1; await loadLogs(false); return '已显示全部审计记录。' }, false))
$('check-log-permission').addEventListener('click', () => perform('检查学生权限', async () => {
  try { await api('/admin/logs', { actor: 'student-101' }) }
  catch (error) { if (error.status === 403 && error.code === 'FORBIDDEN') return '权限验收通过：学生 101 查询审计被接口拒绝（403），拒绝操作已记录。'; throw error }
  throw new Error('权限验收未通过：学生身份意外获得了审计查询权限。')
}))

async function start() {
  syncControls()
  try {
    const { status, result } = await localFetch('session')
    if (status >= 400) throw apiError(status, result)
    state.key = result.data.session_key
    $('database-address').textContent = `127.0.0.1:${result.data.database_port} · 模拟身份`
    const errors = await refreshAll()
    notice(errors.length ? `部分数据未能加载：${errors.join('；')}` : '已连接本地数据库。选择左侧模块开始测试，写入结果会保留。', errors.length ? 'bad' : 'neutral')
    state.ready = true
  } catch (error) {
    notice(error.message, 'bad')
    $('connection-status').textContent = '连接失败'
    $('connection-status').className = 'status bad'
  } finally { syncControls() }
}
await start()
