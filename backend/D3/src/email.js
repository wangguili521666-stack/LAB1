import nodemailer from 'nodemailer'

export function eligible(kind, booking, userId, now = Date.now()) {
  if (String(booking.user_id) !== String(userId)) return false
  const delta = now - new Date(booking.start_time).getTime()
  if (kind === 'NO_SHOW') return booking.status === 'NO_SHOW'
  if (booking.status !== 'BOOKED') return false
  return kind === 'BOOKING_REMINDER' ? delta >= -900000 && delta < 0
    : kind === 'LATE_REMINDER' && delta >= 600000 && delta < 900000
}
export function transport(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error('SMTP 配置不完整')
  return nodemailer.createTransport({host:env.SMTP_HOST, port:Number(env.SMTP_PORT || 465), secure:true,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}, connectionTimeout:10000, greetingTimeout:10000, socketTimeout:20000})
}
async function internal(base, path, token) {
  const r = await fetch(new URL(path, base), {headers:{'X-Service-Token':token}, signal:AbortSignal.timeout(5000), redirect:'error'})
  if (!r.ok) throw Object.assign(new Error('DEPENDENCY_ERROR'), {code:`HTTP_${r.status}`})
  return (await r.json()).data
}
export function startEmailWorker(pool, env = process.env) {
  if (env.SMTP_ENABLED !== 'true') return async () => {}
  if (!env.D1_D3_SERVICE_TOKEN || !env.M1_D3_SERVICE_TOKEN || !env.M1_BASE_URL || !env.D1_BASE_URL) throw new Error('邮件服务内部连接配置不完整')
  const sender = transport(env)
  let pending, stopped = false
  async function run() {
    const c = await pool.getConnection()
    let locked = false
    try {
      // A connection-owned lock serializes workers and releases automatically on connection loss.
      const [[lock]] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':email-worker'), 0) AS acquired")
      locked = Number(lock.acquired) === 1
      if (!locked) return
      const [jobs] = await c.query(`SELECT j.*, n.biz_id,n.notification_type,n.title,n.content,n.invalidated_at,n.expires_at
        FROM d3_email_jobs j JOIN d3_notifications n ON n.id=j.notification_id
        WHERE j.status='PENDING' AND j.next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY j.id LIMIT 20`)
      for (const job of jobs) {
        if (stopped) break
        try {
          const expired = job.expires_at && new Date(job.expires_at.replace(' ', 'T')+'Z').getTime() <= Date.now()
          const b = await internal(env.M1_BASE_URL, `/api/m1/internal/bookings/${encodeURIComponent(job.biz_id)}/reminder-state`, env.M1_D3_SERVICE_TOKEN)
          if (job.invalidated_at || expired || !eligible(job.notification_type, b, job.user_id)) {
            await c.query("UPDATE d3_email_jobs SET status='SKIPPED' WHERE id=?", [job.id]); continue
          }
          const contact = await internal(env.D1_BASE_URL, `/api/d1/internal/users/${job.user_id}/email`, env.D1_D3_SERVICE_TOKEN)
          if (typeof contact.email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email)) throw Object.assign(new Error('NO_EMAIL'), {code:'NO_EMAIL'})
          const time = new Date(b.start_time).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false})
          const result = await sender.sendMail({from:{name:'校园座位预约系统',address:env.SMTP_USER}, to:{address:contact.email},
            subject:job.notification_type === 'LATE_REMINDER' ? '预约已开始，请尽快签到' : job.title,
            messageId:`<campus-d3-${env.SMTP_USER.split('@')[0]}-${job.id}@${env.SMTP_USER.split('@')[1]}>`,
            text:`${job.content}\n\n预约编号：${job.biz_id}\n座位编号：${b.seat_id}\n预约开始时间：${time}（北京时间）\n请登录校园座位预约系统查看详情。`})
          if (!result.accepted?.length) throw Object.assign(new Error('SMTP_REJECTED'), {code:'SMTP_REJECTED'})
          await c.query("UPDATE d3_email_jobs SET status='SUBMITTED',sent_at=UTC_TIMESTAMP(3),attempts=attempts+1,last_error=NULL WHERE id=?", [job.id])
        } catch (e) {
          const attempts = Number(job.attempts)+1
          // Never persist SMTP error messages: they may contain recipient details or credentials.
          const code = /^[A-Z0-9_]{1,64}$/.test(e.code || '') ? e.code : 'SEND_FAILED'
          await c.query("UPDATE d3_email_jobs SET attempts=?,status=?,last_error=?,next_attempt_at=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)) WHERE id=?",
            [attempts, attempts>=8?'FAILED':'PENDING', code, Math.min(3600,30*2**(attempts-1)),job.id])
          console.error('D3_EMAIL_RETRY', {job_id:job.id,code})
        }
      }
    } finally {
      if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':email-worker'))").catch(()=>{})
      c.release()
    }
  }
  function tick() { if (!pending && !stopped) pending = run().catch(()=>console.error('D3_EMAIL_WORKER_FAILED')).finally(()=>{pending=null}) }
  const timer = setInterval(tick,5000); timer.unref(); tick()
  return async () => {stopped=true;clearInterval(timer);await pending;sender.close()}
}
