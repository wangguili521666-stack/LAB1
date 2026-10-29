import {createHmac} from 'node:crypto'
export function dailyCode(secret,room,now=new Date()){const day=new Date(+now+8*3600000).toISOString().slice(0,10);return String(parseInt(createHmac('sha256',secret).update(room+':'+day).digest('hex').slice(0,10),16)%1000000).padStart(6,'0')}
export function displayCode(secret,room,now=new Date()){return {code:dailyCode(secret,room,now),server_time:now.toISOString(),valid_until:new Date(Math.floor((+now+8*3600000)/86400000)*86400000+86400000-8*3600000).toISOString()}}
