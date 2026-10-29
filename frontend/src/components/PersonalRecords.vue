<script setup>
import {ref,onMounted} from 'vue'
import {request} from '../utils/request.js'
const type=ref('seat_bookings'),page=ref(1),result=ref(null),error=ref(''),busy=ref(false)
const names={seat_bookings:'座位预约',classroom_applications:'教室申请',repair_tickets:'物业报修'}
let version=0
async function load(){const v=++version;busy.value=true;error.value='';result.value=null;try{const r=await request('/api/d1/users/me/records?'+new URLSearchParams({type:type.value,page:page.value,page_size:10}));if(v===version)result.value=r[type.value]}catch(e){if(v===version)error.value=e.message}finally{if(v===version)busy.value=false}}
onMounted(load)
</script>
<template><section class="panel records"><h2>我的业务记录</h2><label>记录类型 <select v-model="type" @change="page=1;load()"><option v-for="(name,key) in names" :value="key" :key="key">{{name}}</option></select></label><button :disabled="busy" @click="load">刷新</button><p role="alert">{{error}}</p><p v-if="busy">正在加载…</p><template v-if="result"><p v-if="!result.items.length">暂无记录</p><article v-for="r in result.items" :key="r.id"><strong>{{names[type]}} #{{r.id}}</strong><span>{{r.status}}</span><p>{{r.purpose||r.description||(r.start_time+' — '+r.end_time)}}</p><small>{{r.created_at}}</small></article><button :disabled="page===1||busy" @click="page--;load()">上一页</button> 第 {{page}} 页 · 共 {{result.total}} 条 <button :disabled="page*10>=result.total||busy" @click="page++;load()">下一页</button></template></section></template>
<style scoped>.records{padding:24px;margin-top:24px}article{padding:16px;border-bottom:1px solid #ddd}span{float:right}button,select{padding:8px;margin:8px}</style>
