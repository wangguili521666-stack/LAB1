import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../utils/request.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('../views/Login.vue'),
      meta: { title: '登录' },
    },
    {
      path: '/m1',
      component: () => import('../views/M1.vue'),
      meta: { title: '座位预约', requiresAuth: true },
    },
    {
      path: '/m2',
      component: () => import('../views/M2.vue'),
      meta: { title: '教室申请', requiresAuth: true },
    },
    {
      path: '/m3',
      component: () => import('../views/M3.vue'),
      meta: { title: '物业报修', requiresAuth: true },
    },
    {
      path: '/profile',
      component: () => import('../views/Profile.vue'),
      meta: { title: '个人中心', requiresAuth: true },
    },
    {path:'/role-admin',component:()=>import('../views/RoleAdmin.vue'),meta:{title:'角色权限管理',requiresAuth:true}},
    {path:'/checkin-screen',component:()=>import('../views/CheckinScreen.vue'),meta:{title:'教室签到屏幕',requiresAuth:true,kiosk:true}},
    { path: '/messages', component: () => import('../views/Messages.vue'), meta: {title: '我的消息', requiresAuth: true} },
    { path: '/:pathMatch(.*)*', redirect: '/m1' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
router.beforeEach((to) => {
  if (to.meta.requiresAuth && !getToken())
    return { path: '/login', query: { redirect: to.fullPath } }
  if (to.path === '/login' && getToken()) return '/m1'
})
router.afterEach((to) => {
  document.title = `${to.meta.title || '首页'} · 校园资源服务平台`
})
export default router
