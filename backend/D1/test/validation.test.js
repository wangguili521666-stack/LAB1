import test from 'node:test'
import assert from 'node:assert/strict'
import {validateProfile,validateCredentials} from '../src/validation.js'
test('invalid credential types and oversized bcrypt input rejected before database',()=>{
 for(const body of [null,{}, {username:[],password:'test'}, {username:'u',password:{}}, {username:'u',password:'密'.repeat(25)}])
  assert.throws(()=>validateCredentials(body,true),e=>e.status===400)
 assert.doesNotThrow(()=>validateCredentials({username:'student',password:'密'.repeat(24),college_id:'9223372036854775807'},true))
})
test('profile accepts empty optional fields and rejects malformed email/oversized strings',()=>{
 assert.doesNotThrow(()=>validateProfile({email:null,phone:'',nickname:'学生'}))
 for(const body of [{email:'not-an-email'}, {phone:'1'.repeat(21)}, {nickname:{}}, {email:['a@example.com']}])
  assert.throws(()=>validateProfile(body),e=>e.status===400)
})
