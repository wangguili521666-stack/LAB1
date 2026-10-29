<script setup>
import { watch, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isAuthenticated, request } from './utils/request.js'
import AppIcon from './components/AppIcon.vue'
const route = useRoute(),
  router = useRouter()
const links = [
  {to:'/role-admin',name:'角色权限',icon:'user',note:'管理员配置'},
  {to:'/checkin-screen',name:'教室签到屏幕',icon:'room',note:'每日现场签到码'},
  { to: '/messages', name: '我的消息', icon: 'user', note: '查看预约提醒与通知' },
  { to: '/m1', name: '座位预约', icon: 'seat', note: '找一个专注的角落' },
  { to: '/m2', name: '教室申请', icon: 'room', note: '让交流有处发生' },
  { to: '/m3', name: '物业报修', icon: 'repair', note: '一起照顾我们的校园' },
  { to: '/profile', name: '个人中心', icon: 'user', note: '管理你的校园账号' },
]
const identity=ref(null)
watch(isAuthenticated,async(value)=>{identity.value=null;if(value){try{const u=await request('/api/d1/users/me');if(isAuthenticated())identity.value=u}catch{}}},{immediate:true})
const visibleLinks=computed(()=>links.filter(l=>l.to==='/role-admin'?identity.value?.roles.includes('SYSTEM_ADMIN'):l.to==='/checkin-screen'?(identity.value?.roles.includes('SYSTEM_ADMIN')||identity.value?.permissions?.includes('checkin:display')):true))
watch(isAuthenticated, (value) => {
  if (!value && route.meta.requiresAuth)
    router.replace({ path: '/login', query: { redirect: route.fullPath } })
})
</script>
<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>
  <div v-if="route.path !== '/login' && !route.meta.kiosk && isAuthenticated()" class="app-shell">
    <aside class="sidebar">
      <router-link to="/m1" class="brand"
        ><span class="brand-mark"><AppIcon name="campus" /></span
        ><span
          >校园资源<span class="brand-caption">CAMPUS SERVICES</span></span
        ></router-link
      >
      <p class="nav-label">校园服务</p>
      <nav aria-label="主导航">
        <router-link
          v-for="link in visibleLinks"
          :key="link.to"
          :to="link.to"
          class="nav-item"
          ><AppIcon :name="link.icon" /><span
            >{{ link.name }}<small>{{ link.note }}</small></span
          ></router-link
        >
      </nav>
      <div class="sidebar-note">
        <span class="live-dot"></span> 更好的校园生活
        <p>让每一份资源，恰好为你所用。</p>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span
          >服务大厅 <span class="crumb">/</span>
          <strong>{{ route.meta.title }}</strong></span
        ><span class="topbar-note">学习 · 连接 · 生活</span>
      </header>
      <main id="main" class="main-content"><router-view /></main>
      <footer>校园资源服务平台 <span>为专注与成长，留一片空间。</span></footer>
    </div>
  </div>
  <main v-else id="main"><router-view /></main>
</template>
