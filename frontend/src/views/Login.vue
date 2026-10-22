<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { request, setToken } from '../utils/request.js'
import { useTask } from '../composables/useTask.js'
import Feedback from '../components/Feedback.vue'
import AppIcon from '../components/AppIcon.vue'
const route = useRoute(),
  router = useRouter()
const mode = ref('login'),
  showPassword = ref(false)
const registering = computed(() => mode.value === 'register')
const form = ref({
  username: '',
  password: '',
  nickname: '',
  email: '',
  phone: '',
  college_id: '',
})
const { pending, error, success, run } = useTask()
function toggleMode() {
  mode.value = registering.value ? 'login' : 'register'
  error.value = success.value = ''
  form.value.password = ''
  showPassword.value = false
}
async function submit() {
  await run(async () => {
    const username = form.value.username.trim()
    if (!username || !form.value.password) throw new Error('请填写用户名和密码')
    if (registering.value) {
      await request('/api/d1/auth/register', {
        method: 'POST',
        auth: false,
        body: Object.fromEntries(
          Object.entries({ ...form.value, username }).filter(
            ([, value]) => value !== '',
          ),
        ),
      })
      // Registration succeeded: a failed automatic login must not register the account again.
      mode.value = 'login'
      success.value = '账号已创建，请登录'
    }
    const data = await request('/api/d1/auth/login', {
      method: 'POST',
      auth: false,
      body: { username, password: form.value.password },
    })
    if (!data?.access_token) throw new Error('登录响应异常，请重试')
    setToken(data.access_token)
    const target = route.query.redirect
    await router.replace(
      typeof target === 'string' && /^\/(m[123]|profile)(\?|$)/.test(target)
        ? target
        : '/profile',
    )
  })
}
</script>
<template>
  <div class="auth-layout">
    <section class="auth-story" aria-label="校园资源服务平台">
      <div class="brand">
        <span class="brand-mark"><AppIcon name="campus" /></span
        ><span>校园资源<span class="brand-caption">CAMPUS SERVICES</span></span>
      </div>
      <div class="story-copy">
        <p class="eyebrow">YOUR CAMPUS, CONNECTED</p>
        <h1>把时间留给热爱，<br />把琐事交给我们。</h1>
        <p>
          从一个安静的自习座位，到一次灵感碰撞的课堂。<br />在这里，轻松连接你的校园生活。
        </p>
      </div>
      <div class="campus-art" aria-hidden="true">
        <div class="art-sun"></div>
        <div class="art-building building-back">
          <i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="art-building building-front">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="art-tree tree-one"></div>
        <div class="art-tree tree-two"></div>
        <div class="art-ground"></div>
        <span class="art-caption">A LITTLE SPACE. A LOT OF POSSIBILITY.</span>
      </div>
      <div class="story-services">
        <span><AppIcon name="seat" />座位预约</span
        ><span><AppIcon name="room" />教室申请</span
        ><span><AppIcon name="repair" />物业报修</span>
      </div>
    </section>
    <section class="auth-form-side">
      <div class="auth-card">
        <p class="eyebrow">
          {{ registering ? 'START YOUR JOURNEY' : 'WELCOME BACK' }}
        </p>
        <h2>
          {{ registering ? '开启你的校园生活' : '欢迎回来'
          }}<span class="title-dot">.</span>
        </h2>
        <p class="muted">
          {{
            registering
              ? '创建账号，让校园服务触手可及。'
              : '登录校园账号，继续你的精彩日常。'
          }}
        </p>
        <form @submit.prevent="submit">
          <fieldset :disabled="pending">
            <label
              >用户名<input
                v-model="form.username"
                required
                autocomplete="username"
                placeholder="请输入用户名"
            /></label>
            <label
              >密码<span class="password-field"
                ><input
                  v-model="form.password"
                  required
                  :type="showPassword ? 'text' : 'password'"
                  :autocomplete="
                    registering ? 'new-password' : 'current-password'
                  "
                  placeholder="请输入密码"
                /><button
                  type="button"
                  class="password-toggle"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? '隐藏' : '显示' }}
                </button></span
              ></label
            >
            <div v-if="registering" class="form-grid">
              <label
                >昵称 <small>选填</small
                ><input
                  v-model="form.nickname"
                  autocomplete="nickname"
                  placeholder="怎么称呼你"
              /></label>
              <label
                >学院 ID <small>选填</small
                ><input
                  v-model="form.college_id"
                  inputmode="numeric"
                  pattern="[0-9]+"
                  placeholder="请输入学院编号"
              /></label>
              <label
                >邮箱 <small>选填</small
                ><input
                  v-model="form.email"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
              /></label>
              <label
                >手机号 <small>选填</small
                ><input
                  v-model="form.phone"
                  type="tel"
                  autocomplete="tel"
                  placeholder="请输入手机号"
              /></label>
            </div>
            <Feedback :error="error" :success="success" />
            <button type="submit" class="button primary auth-submit">
              {{
                pending
                  ? '正在处理…'
                  : registering
                    ? '创建账号并登录'
                    : '登 录'
              }}<span aria-hidden="true">→</span>
            </button>
          </fieldset>
        </form>
        <p class="auth-switch">
          {{ registering ? '已有校园账号？' : '还没有账号？' }}
          <button class="text-button" :disabled="pending" @click="toggleMode">
            {{ registering ? '立即登录' : '创建账号' }}
          </button>
        </p>
        <div class="auth-footnote">
          <span class="live-dot"></span> 一个账号，连接校园里的每一种可能
        </div>
      </div>
      <p class="auth-copyright">校园资源服务平台 · 让校园生活更简单</p>
    </section>
  </div>
</template>
