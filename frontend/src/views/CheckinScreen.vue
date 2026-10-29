<script setup>
import {ref,onMounted,onUnmounted,computed} from 'vue'
import {request} from '../utils/request.js'
const classroom=ref(''),data=ref(null),error=ref(''),now=ref(Date.now()),busy=ref(false),selected=ref('')
let timer,refresh,version=0,offset=0
const remaining=computed(()=>data.value?Math.max(0,Math.ceil((Date.parse(data.value.valid_until)-(now.value+offset))/1000)):0)
async function load(){const v=++version;busy.value=true;try{const result=await request('/api/m1/admin/checkin-code/'+encodeURIComponent(selected.value));if(v!==version)return;offset=Date.parse(result.server_time)-Date.now();data.value=result;error.value=''}catch(e){if(v===version){data.value=null;error.value=e.message}}finally{if(v===version)busy.value=false}}
async function show(){if(!/^[1-9]\d*$/.test(classroom.value)){error.value='请输入有效教室 ID';return}selected.value=classroom.value;data.value=null;await load()}
async function fullscreen(){try{await document.documentElement.requestFullscreen()}catch{error.value='浏览器未允许全屏，可按 F11 或使用浏览器全屏菜单'}}
onMounted(()=>{timer=setInterval(()=>{now.value=Date.now();if(data.value&&remaining.value===0){data.value=null;if(!busy.value)load()}},1000);refresh=setInterval(()=>{if(selected.value&&!busy.value)load()},15000)})
onUnmounted(()=>{version++;clearInterval(timer);clearInterval(refresh)})
</script>
<template><div class="screen"><header><router-link to="/m1">← 返回服务大厅</router-link><button @click="fullscreen">全屏展示</button></header><form @submit.prevent="show"><label>教室 ID <input v-model="classroom" inputmode="numeric" required></label><button :disabled="busy">展示签到码</button></form><p role="alert">{{error}}</p><section v-if="data&&remaining>0"><p class="eyebrow">教室现场签到</p><h1>{{data.building}} · {{data.room_number}}</h1><p>请在“我的预约”中输入下方编码</p><div class="code" aria-label="今日签到码">{{data.code}}</div><p>北京时间每日更新 · {{new Date(data.valid_until).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}} 失效</p><p>请在预约开始后 15 分钟内签到</p></section><section v-else><h1>{{busy?'正在获取当日签到码…':'签到码未展示'}}</h1><p>请由管理员登录并选择教室。连接失败或编码过期时会自动隐藏。</p></section><footer>校园资源服务平台 · {{new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}}</footer></div></template>
<style scoped>.screen{min-height:100vh;background:#102b38;color:#fff;padding:24px;text-align:center}header{display:flex;justify-content:space-between}a{color:#b6dfeb}form{display:flex;justify-content:center;gap:12px;margin:24px}input,button{padding:10px;border-radius:8px;border:1px solid #7c9da8}section{margin:8vh auto;max-width:1100px}h1{font-size:clamp(28px,4vw,64px)}.code{font-size:clamp(70px,17vw,240px);letter-spacing:.1em;font-weight:800;font-variant-numeric:tabular-nums;color:#aaf0d1}p{font-size:20px}footer{color:#9fb9c5}</style>
