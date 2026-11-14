<script setup>
import { computed, onMounted, ref } from 'vue'
import { request } from '../utils/request.js'
const user=ref(null), colleges=ref([]), rooms=ref([]), seats=ref([]), selected=ref(null)
const busy=ref(false), ready=ref(false), error=ref(''), success=ref(''), page=ref(1), total=ref(0)
const filters=ref({building:'',room_number:'',status:''}), roomDraft=ref(null), seatDraft=ref(null)
const system=computed(()=>user.value?.roles?.includes('SYSTEM_ADMIN'))
const allowed=computed(()=>system.value || (user.value?.permissions?.includes('resource:manage') && user.value?.college_id))
const statuses={AVAILABLE:'可用',MAINTENANCE:'维护中',DISABLED:'停用'}
const sockets={NONE:'无插座',FIXED:'固定插座',RAIL:'导轨插座'}
const collegeName=id=>colleges.value.find(c=>String(c.id)===String(id))?.name || (id ? `学院 ${id}`:'公共教室')
async function run(fn){
  if(busy.value)return
  busy.value=true;error.value='';success.value=''
  try{await fn()}catch(e){error.value=e.message;if(e.status===403){user.value=null;rooms.value=[];selected.value=null;roomDraft.value=null;seatDraft.value=null}}
  finally{busy.value=false}
}
async function loadRooms(){
  const q=new URLSearchParams({page:page.value,page_size:20})
  for(const [k,v] of Object.entries(filters.value))if(v.trim())q.set(k,v.trim())
  if(!system.value)q.set('college_id',user.value.college_id)
  const data=await request('/api/d2/classrooms?'+q)
  if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.total))throw Error('教室列表格式异常，请重试')
  rooms.value=data.items;total.value=data.total
}
async function selectRoom(room){await run(async()=>{
  selected.value=null;seats.value=[];seatDraft.value=null;roomDraft.value=null
  const detail=await request(`/api/d2/classrooms/${room.id}`)
  if(!system.value && detail.college_id!==user.value.college_id)throw Error('只能管理本学院资源')
  const data=await request(`/api/d2/classrooms/${room.id}/seats`)
  selected.value=detail;seats.value=data
})}
function editRoom(room=null){
  seatDraft.value=null
  roomDraft.value=room ? {...room,equipment:{...room.equipment}} : {building:'',room_number:'',college_id:system.value?null:user.value.college_id,capacity:1,equipment:{projector:false},is_bookable_whole:false,open_time:'08:00',close_time:'22:00'}
}
function editSeat(seat=null){roomDraft.value=null;seatDraft.value=seat ? {...seat} : {seat_number:'',socket_type:'NONE'}}
const time=value=>value.length===5?value+':00':value
async function saveRoom(){await run(async()=>{
  const d=roomDraft.value
  const body={building:d.building.trim(),room_number:d.room_number.trim(),college_id:system.value?(d.college_id||null):user.value.college_id,capacity:Number(d.capacity),equipment:d.equipment,is_bookable_whole:d.is_bookable_whole,open_time:time(d.open_time),close_time:time(d.close_time)}
  if(d.id)body.status=d.status
  let saved
  try{saved=await request(d.id?`/api/d2/classrooms/${d.id}`:'/api/d2/classrooms',{method:d.id?'PATCH':'POST',body})}
  catch(e){if(!e.status || e.status>=500)e.message+='；结果可能尚未确认，请先查询列表，避免重复新增。';throw e}
  roomDraft.value=null;success.value='教室已保存。座位需在“管理座位”中单独添加。'
  if(selected.value?.id===saved.id)selected.value=saved
  try{await loadRooms()}catch{error.value='教室已保存，但列表刷新失败，请点击查询刷新。'}
})}
async function saveSeat(){await run(async()=>{
  const d=seatDraft.value, roomId=selected.value.id
  const body={seat_number:d.seat_number.trim(),socket_type:d.socket_type}
  if(d.id)body.status=d.status;else body.classroom_id=roomId
  try{await request(d.id?`/api/d2/seats/${d.id}`:'/api/d2/seats',{method:d.id?'PATCH':'POST',body})}
  catch(e){if(!e.status || e.status>=500)e.message+='；结果可能尚未确认，请先刷新座位，避免重复新增。';throw e}
  seatDraft.value=null;success.value='座位已保存。'
  try{seats.value=await request(`/api/d2/classrooms/${roomId}/seats`)}catch{error.value='座位已保存，但列表刷新失败，请点击刷新座位。'}
})}
onMounted(()=>run(async()=>{
  user.value=await request('/api/d1/users/me');ready.value=true
  if(!allowed.value)return
  colleges.value=await request('/api/d1/colleges');await loadRooms()
}))
</script>
<template>
  <div class="resources">
    <header><p class="eyebrow">校园资源 · 管理工作台</p><h1>教室与座位管理</h1><p>维护教室资料、开放时间和座位，让预约信息保持准确。</p></header>
    <p v-if="error" role="alert" class="error">{{error}}</p><p v-if="success" role="status" class="success">{{success}}</p>
    <p v-if="busy" role="status">正在处理，请稍候…</p>
    <p v-if="ready && !allowed" class="card">当前账号没有资源管理权限，或尚未绑定学院。请联系系统管理员。</p>
    <fieldset v-if="allowed" :disabled="busy">
      <section class="card">
        <div class="section-head"><div><h2>教室资源</h2><p>{{system?'管理所有学院及公共教室':`管理范围：${collegeName(user.college_id)}`}}</p></div><button @click="editRoom()">新增教室</button></div>
        <form class="filters" @submit.prevent="run(async()=>{page=1;await loadRooms()})">
          <label>教学楼<input v-model="filters.building" placeholder="全部教学楼"></label>
          <label>房间号<input v-model="filters.room_number" placeholder="全部房间"></label>
          <label>教室状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="(label,value) in statuses" :value="value" :key="value">{{label}}</option></select></label><button>查询</button>
        </form>
        <div class="table-wrap"><table><thead><tr><th>教室</th><th>学院</th><th>容量</th><th>开放时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
          <tr v-for="room in rooms" :key="room.id"><td>{{room.building}} · {{room.room_number}}</td><td>{{collegeName(room.college_id)}}</td><td>{{room.capacity}} 人</td><td>{{room.open_time.slice(0,5)}}–{{room.close_time.slice(0,5)}}</td><td>{{statuses[room.status]}}</td><td class="actions"><button @click="editRoom(room)">编辑教室</button><button @click="selectRoom(room)">管理座位</button></td></tr>
        </tbody></table></div><p v-if="!rooms.length && !busy">暂无符合条件的教室。</p>
        <div class="pagination"><button :disabled="page<=1" @click="run(async()=>{page--;await loadRooms()})">上一页</button><span>第 {{page}} 页 · 共 {{total}} 间教室</span><button :disabled="page*20>=total" @click="run(async()=>{page++;await loadRooms()})">下一页</button></div>
      </section>
      <section v-if="roomDraft" class="card editor">
        <h2>{{roomDraft.id?'编辑教室':'新增教室'}}</h2>
        <form @submit.prevent="saveRoom"><div class="grid">
          <label>教学楼<input v-model="roomDraft.building" required maxlength="100"></label><label>房间号<input v-model="roomDraft.room_number" required maxlength="30"></label>
          <label>所属学院<select v-model="roomDraft.college_id" :disabled="!system"><option :value="null">公共教室</option><option v-for="c in colleges" :key="c.id" :value="String(c.id)">{{c.name}}</option></select></label>
          <label>容量（人数）<input v-model="roomDraft.capacity" type="number" min="1" max="2147483647" step="1" required></label>
          <label>开放时间<input type="time" v-model="roomDraft.open_time" required step="1"></label><label>关闭时间<input type="time" v-model="roomDraft.close_time" required step="1"></label>
          <label v-if="roomDraft.id">教室状态<select v-model="roomDraft.status"><option v-for="(label,value) in statuses" :value="value" :key="value">{{label}}</option></select></label>
          <label class="check"><input type="checkbox" v-model="roomDraft.is_bookable_whole">允许整间教室预约</label><label class="check"><input type="checkbox" v-model="roomDraft.equipment.projector">配备投影设备</label>
        </div><p class="hint">维护中或停用的教室不接受新预约。容量不会自动生成座位；已有其他设备资料会保留。</p><div class="actions"><button>保存教室</button><button type="button" @click="roomDraft=null">取消</button></div></form>
      </section>
      <section v-if="selected" class="card">
        <div class="section-head"><div><h2>{{selected.building}} · {{selected.room_number}} 的座位</h2><p>教室状态：{{statuses[selected.status]}} · 共 {{seats.length}} 个座位</p></div><div class="actions"><button @click="selectRoom(selected)">刷新座位</button><button @click="editSeat()">新增座位</button></div></div>
        <p v-if="selected.status!=='AVAILABLE'" class="hint">该教室当前不可预约，即使座位标为可用，也不会开放新预约。</p>
        <div class="table-wrap"><table><thead><tr><th>座位编号</th><th>插座类型</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="seat in seats" :key="seat.id"><td>{{seat.seat_number}}</td><td>{{sockets[seat.socket_type]}}</td><td>{{statuses[seat.status]}}</td><td><button @click="editSeat(seat)">编辑座位</button></td></tr></tbody></table></div><p v-if="!seats.length">暂无座位，点击“新增座位”添加。</p>
      </section>
      <section v-if="seatDraft && selected" class="card editor"><h2>{{seatDraft.id?'编辑座位':'新增座位'}} · {{selected.room_number}}</h2><form @submit.prevent="saveSeat"><div class="grid"><label>座位编号<input v-model="seatDraft.seat_number" required maxlength="20" placeholder="例如 A01"></label><label>插座类型<select v-model="seatDraft.socket_type"><option v-for="(label,value) in sockets" :key="value" :value="value">{{label}}</option></select></label><label v-if="seatDraft.id">座位状态<select v-model="seatDraft.status"><option v-for="(label,value) in statuses" :key="value" :value="value">{{label}}</option></select></label></div><p class="hint">座位所属教室不可更改。停止使用时可将状态设为“停用”。</p><div class="actions"><button>保存座位</button><button type="button" @click="seatDraft=null">取消</button></div></form></section>
    </fieldset>
  </div>
</template>
<style scoped>
.resources{max-width:1200px;margin:auto}.eyebrow{font-size:13px;color:#256653;letter-spacing:2px}h1{font-size:30px}h2{font-size:20px;margin:0 0 8px}header{margin-bottom:28px}p{line-height:1.65}.card{background:#fff;border:1px solid #e1e8e3;border-radius:16px;padding:24px;margin:20px 0}fieldset{border:0;padding:0;margin:0;min-width:0}.section-head,.actions,.pagination{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.section-head{justify-content:space-between;margin-bottom:20px}.filters,.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.filters{grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end;margin-bottom:20px}label{display:flex;flex-direction:column;gap:8px;font-size:14px}input,select{width:100%;min-height:42px;padding:9px 12px;border:1px solid #ccd8d0;border-radius:8px;background:white;color:inherit;font:inherit}.check{flex-direction:row;align-items:center}.check input{width:18px;min-height:18px}button{background:#256653;color:white;border:1px solid #256653;min-height:40px;padding:8px 15px;border-radius:8px;cursor:pointer}button:disabled{opacity:.45;cursor:default}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:14px 10px;border-bottom:1px solid #e8eee9;white-space:nowrap}th{font-size:13px;color:#64766c;background:#f6f9f6}.pagination{justify-content:flex-end;margin-top:18px}.hint{color:#65766d;font-size:14px}.editor{border-color:#8eb6a2}.error,.success{padding:12px 16px;border-radius:8px}.error{color:#922d25;background:#fff0ed}.success{color:#1f6248;background:#e9f5ed}@media(max-width:700px){.grid,.filters{grid-template-columns:1fr}.card{padding:16px}.section-head{align-items:flex-start}h1{font-size:25px}}
</style>
