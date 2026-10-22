<script setup>
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const loggedIn = ref(!!localStorage.getItem('token'))

// 登录/登出后随路由变化刷新导航状态
watch(() => route.fullPath, () => {
  loggedIn.value = !!localStorage.getItem('token')
})
</script>

<template>
  <div>
    <nav v-if="loggedIn">
      <router-link to="/m1">座位预约</router-link> |
      <router-link to="/m2">教室申请</router-link> |
      <router-link to="/m3">物业报修</router-link> |
      <router-link to="/profile">个人信息</router-link>
    </nav>

    <hr v-if="loggedIn" />

    <router-view />
  </div>
</template>