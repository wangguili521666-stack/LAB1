import test from 'node:test'
import assert from 'node:assert/strict'
import {eligible} from '../src/email.js'
const start = Date.parse('2026-11-14T10:00:00+08:00')
const booking = {user_id:'123',status:'BOOKED',start_time:new Date(start).toISOString()}
test('reminders respect exact time windows',()=>{
  assert.equal(eligible('BOOKING_REMINDER',booking,'123',start-900001),false)
  assert.equal(eligible('BOOKING_REMINDER',booking,'123',start-900000),true)
  assert.equal(eligible('BOOKING_REMINDER',booking,'123',start),false)
  assert.equal(eligible('LATE_REMINDER',booking,'123',start+599999),false)
  assert.equal(eligible('LATE_REMINDER',booking,'123',start+600000),true)
  assert.equal(eligible('LATE_REMINDER',booking,'123',start+900000),false)
})
test('checked in, cancelled and wrong recipient cannot get pending reminders',()=>{
  for(const status of ['CHECKED_IN','CANCELLED','EXPIRING','NO_SHOW'])
    assert.equal(eligible('LATE_REMINDER',{...booking,status},'123',start+600000),false)
  assert.equal(eligible('LATE_REMINDER',booking,'456',start+600000),false)
  assert.equal(eligible('NO_SHOW',booking,'123',start+900000),false)
  assert.equal(eligible('NO_SHOW',{...booking,status:'NO_SHOW'},'123',start+900000),true)
})

test('mysql: email queue is atomic, deduplicated and retained across connections', {skip:!process.env.D3_TEST_MYSQL}, async()=>{
  const {createPool,MysqlStore} = await import('../src/stores/mysql.js')
  const {D3Service} = await import('../src/service.js')
  const {migrate} = await import('../scripts/migrate.js')
  const {randomUUID} = await import('node:crypto')
  const config=JSON.parse(process.env.D3_TEST_MYSQL)
  const store=new MysqlStore(createPool(config))
  const previous=process.env.SMTP_ENABLED
  process.env.SMTP_ENABLED='true'
  const ctx={service:{module:'M1'},requestId:randomUUID()}
  const event={source_event_id:randomUUID(),notification_type:'LATE_REMINDER',biz_type:'SEAT_BOOKING',biz_id:'999',recipient_user_ids:['999'],title:'测试',content:'测试',occurred_at:new Date().toISOString()}
  try {
    await migrate(store.pool)
    const service=new D3Service(store)
    const result=await service.notify(event,ctx)
    await service.notify(event,ctx)
    const [jobs]=await store.pool.query('SELECT * FROM d3_email_jobs WHERE notification_id=?',[result.data.id])
    assert.equal(jobs.length,1);assert.equal(jobs[0].status,'PENDING')
    // An error after insertion rolls back both recipients and delivery jobs.
    await assert.rejects(store.transaction(async tx=>{
      await tx.enqueueEmail(result.data.id,['998'],new Date().toISOString())
      throw Error('rollback')
    }),/rollback/)
    const other=createPool(config)
    try {
      const [[count]]=await other.query('SELECT COUNT(*) AS n FROM d3_email_jobs WHERE notification_id=?',[result.data.id])
      assert.equal(Number(count.n),1)
    } finally {await other.end()}
  } finally {
    if(previous===undefined)delete process.env.SMTP_ENABLED;else process.env.SMTP_ENABLED=previous
    await store.close()
  }
})
