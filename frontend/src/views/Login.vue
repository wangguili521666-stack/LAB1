<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { request, setToken } from '../utils/request.js'

const router = useRouter()
const mode = ref('login') // 'login' | 'register'
const form = ref({
  username: '',
  password: '',
  nickname: '',
  email: '',
  phone: '',
  college_id: ''
})
const message = ref('')
const loading = ref(false)

async function submit() {
  if (!form.value.username || !form.value.password) {
    message.value = '请填写用户名和密码'
    return
  }

  loading.value = true
  message.value = ''

  try {
    if (mode.value === 'register') {
      await request('/api/d1/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          username: form.value.username,
          password: form.value.password,
          nickname: form.value.nickname || undefined,
          email: form.value.email || undefined,
          phone: form.value.phone || undefined,
          college_id: form.value.college_id || undefined
        }
      })
    }

    // 注册成功后直接登录
    const data = await request('/api/d1/auth/login', {
      method: 'POST',
      auth: false,
      body: { username: form.value.username, password: form.value.password }
    })
    setToken(data.access_token)
    router.push('/profile')
  } catch (e) {
    message.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <h1>{{ mode === 'login' ? '登录' : '注册' }}</h1>

    <form @submit.prevent="submit">
      <label>用户名：<input v-model="form.username" autocomplete="username" /></label>
      <label>密码：<input v-model="form.password" type="password" autocomplete="current-password" /></label>

      <template v-if="mode === 'register'">
        <label>昵称：<input v-model="form.nickname" /></label>
        <label>邮箱：<input v-model="form.email" type="email" /></label>
        <label>手机号：<input v-model="form.phone" /></label>
        <label>学院 ID（可选）：<input v-model="form.college_id" /></label>
      </template>

      <button type="submit" :disabled="loading">
        {{ loading ? '提交中...' : (mode === 'login' ? '登录' : '注册并登录') }}
      </button>
    </form>

    <p class="toggle">
      <a href="#" @click.prevent="mode = mode === 'login' ? 'register' : 'login'; message = ''">
        {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
      </a>
    </p>

    <p class="message">{{ message }}</p>
  </div>
</template>

<style scoped>
.auth-page {
  max-width: 420px;
  margin: 40px auto;
  padding: 24px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-family: Arial, sans-serif;
}
label {
  display: block;
  margin: 12px 0;
}
input {
  width: 100%;
  padding: 8px;
  margin-top: 4px;
  box-sizing: border-box;
}
button {
  margin-top: 12px;
  padding: 8px 16px;
  cursor: pointer;
}
.toggle {
  margin-top: 12px;
}
.message {
  color: #2563eb;
}
</style>
