import { test } from 'node:test'
import assert from 'node:assert/strict'
const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key,value), removeItem: key => values.delete(key) }
globalThis.window = { addEventListener() {} }
const { request, setToken, getToken } = await import('../src/utils/request.js')
const { useTask } = await import('../src/composables/useTask.js')
const reply = (status, data) => ({status,ok:status<400,json:async()=>data})
test('authenticated request preserves API envelope and JSON body', async()=>{
 setToken('test-token'); globalThis.fetch=async(path,options)=>{assert.equal(options.headers.Authorization,'Bearer test-token');assert.equal(options.body,'{"nickname":"test"}');return reply(200,{code:'OK',data:{id:'101'}})}
 assert.deepEqual(await request('/api/d1/users/me',{method:'PATCH',body:{nickname:'test'}}),{id:'101'})
})
test('401 clears the current session',async()=>{globalThis.fetch=async()=>reply(401,{code:'UNAUTHORIZED',message:'登录已过期'});await assert.rejects(request('/api/d1/users/me'),/登录已过期/);assert.equal(getToken(),null)})
test('public login failure does not clear a newer session',async()=>{setToken('new-token');globalThis.fetch=async()=>reply(401,{code:'UNAUTHORIZED',message:'密码错误'});await assert.rejects(request('/api/d1/auth/login',{auth:false}),/密码错误/);assert.equal(getToken(),'new-token')})
test('stale request cannot clear replacement token',async()=>{setToken('old-token');globalThis.fetch=async()=>{setToken('replacement');return reply(401,{code:'UNAUTHORIZED'})};await assert.rejects(request('/api/d1/users/me'));assert.equal(getToken(),'replacement')})
test('network and non-JSON server errors are readable',async()=>{globalThis.fetch=async()=>{throw new TypeError('fetch failed')};await assert.rejects(request('/api/test'),/无法连接服务/);globalThis.fetch=async()=>({status:502,ok:false,json:async()=>{throw Error()}});await assert.rejects(request('/api/test'),/服务暂时不可用/)})
test('task prevents duplicate submission and recovers after errors',async()=>{const task=useTask();let finish;const first=task.run(()=>new Promise(resolve=>{finish=resolve}),'已保存');assert.equal(task.pending.value,true);assert.equal(await task.run(()=>{throw Error('must not run')}),false);finish();assert.equal(await first,true);assert.equal(task.success.value,'已保存');await task.run(()=>{throw Error('测试错误')});assert.equal(task.error.value,'测试错误');assert.equal(task.pending.value,false);assert.equal(task.success.value,'')})
