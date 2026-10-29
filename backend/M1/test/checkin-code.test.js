import {test} from 'node:test'
import assert from 'node:assert/strict'
import {dailyCode,displayCode} from '../src/checkin-code.js'
const secret='test-only-secret-do-not-deploy-123456'
test('北京时间午夜切换，同一天稳定、不同教室不同，过期时间为次日零点',()=>{const before=new Date('2026-10-29T15:59:59.999Z'),after=new Date('2026-10-29T16:00:00Z');assert.match(dailyCode(secret,'1',before),/^\d{6}$/);assert.equal(dailyCode(secret,'1',before),dailyCode(secret,'1',new Date('2026-10-29T00:00:00Z')));assert.notEqual(dailyCode(secret,'1',before),dailyCode(secret,'1',after));assert.notEqual(dailyCode(secret,'1',before),dailyCode(secret,'2',before));assert.equal(displayCode(secret,'1',before).valid_until,after.toISOString());assert.equal(displayCode(secret,'1',after).valid_until,'2026-10-30T16:00:00.000Z')})
