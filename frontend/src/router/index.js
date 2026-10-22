import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../utils/request.js'

const routes = [
  { path: '/login', component: () => import('../views/Login.vue') },
  { path: '/profile', component: () => import('../views/Profile.vue'), meta: { requiresAuth: true } },
  { path: '/m1', component: () => import('../views/M1.vue'), meta: { requiresAuth: true } },
  { path: '/m2', component: () => import('../views/M2.vue'), meta: { requiresAuth: true } },
  { path: '/m3', component: () => import('../views/M3.vue'), meta: { requiresAuth: true } },
  { path: '/', redirect: '/login' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 全局路由守卫：未登录只能访问 /login；已登录访问 /login 时跳回首页
router.beforeEach((to) => {
  const authed = !!getToken()
  if (to.meta.requiresAuth && !authed) {
    return { path: '/login' }
  }
  if (to.path === '/login' && authed) {
    return { path: '/m1' }
  }
  return true
})

export default router