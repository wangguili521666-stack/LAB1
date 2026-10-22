import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/m1', component: () => import('../views/M1.vue') },
  { path: '/m2', component: () => import('../views/M2.vue') },
  { path: '/m3', component: () => import('../views/M3.vue') },
  { path: '/', redirect: '/m1' }
]

export default createRouter({
  history: createWebHistory(),
  routes
})