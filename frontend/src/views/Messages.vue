<script setup>
import {ref,onMounted} from 'vue'
import {request} from '../utils/request.js'
const messages=ref([]),error=ref(''),busy=ref(false)
async function load(){busy.value=true;error.value='';try{messages.value=(await request('/api/d3/messages/me?page_size=100')).items}catch(e){error.value=e.message}finally{busy.value=false}}
async function read(m){try{await request(`/api/d3/messages/me/${m.id}/read`,{method:'POST',body:{}});await load()}catch(e){error.value=e.message}}
onMounted(load)
</script>
<template><section><h1>我的消息</h1><p>预约提醒、迟到提醒与违约通知会显示在这里。</p><button :disabled="busy" @click="load">刷新消息</button><p role="alert">{{error}}</p><p v-if="!busy&&!messages.length">暂无消息</p><article v-for="m in messages" :key="m.id"><h2>{{m.title}} <small>{{m.is_read?'已读':'未读'}}</small></h2><p>{{m.content}}</p><p>{{new Date(m.created_at).toLocaleString()}} · {{m.source_module}} <span v-if="!m.is_active">（已失效）</span></p><button v-if="!m.is_read" @click="read(m)">标为已读</button></article></section></template>
<style scoped>article{padding:20px;margin:16px 0;background:white;border:1px solid #ddd;border-radius:12px}small{font-size:14px;font-weight:normal}button{padding:8px 16px}</style>
