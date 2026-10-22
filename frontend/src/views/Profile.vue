<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { request, getToken, clearToken } from '../utils/request.js'

const router = useRouter()
const profile = ref(null)
const editing = ref(false)
const form = ref({ nickname: '', email: '', phone: '' })
const message = ref('')

async function load() {
  try {
    profile.value = await request('/api/d1/users/me')
  } catch (e) {
    message.value = e.message
    if (e.status === 401) router.push('/login')
  }
}

function startEdit() {
  form.value = {
    nickname: profile.value.nickname || '',
    email: profile.value.email || '',
    phone: profile.value.phone || ''
  }
  editing.value = true
}

async function save() {
  message.value = ''
  try {
    profile.value = await request('/api/d1/users/me', {
      method: 'PATCH',
      body: {
        nickname: form.value.nickname,
        email: form.value.email,
        phone: form.value.phone
      }
    })
    editing.value = false
    message.value = '已保存'
  } catch (e) {
    message.value = e.message
  }
}

async function logout() {
  try {
    await request('/api/d1/auth/logout', { method: 'POST' })
  } catch (e) {
    // 登出接口失败也照常清除本地凭证
  }
  clearToken()
  router.push('/login')
}

onMounted(() => {
  if (!getToken()) {
    router.push('/login')
    return
  }
  load()
})
</script>

<template>
  <div class="profile-page">
    <h1>个人信息</h1>

    <div v-if="profile">
      <div v-if="!editing">
        <dl>
          <dt>用户名</dt><dd>{{ profile.username }}</dd>
          <dt>昵称</dt><dd>{{ profile.nickname }}</dd>
          <dt>邮箱</dt><dd>{{ profile.email || '—' }}</dd>
          <dt>手机号</dt><dd>{{ profile.phone || '—' }}</dd>
          <dt>学院 ID</dt><dd>{{ profile.college_id || '—' }}</dd>
          <dt>状态</dt><dd>{{ profile.status }}</dd>
          <dt>角色</dt><dd>{{ profile.roles.join(', ') }}</dd>
          <dt>注册时间</dt><dd>{{ profile.created_at }}</dd>
        </dl>

        <button @click="startEdit">编辑资料</button>
      </div>

      <form v-else @submit.prevent="save">
        <label>昵称：<input v-model="form.nickname" /></label>
        <label>邮箱：<input v-model="form.email" type="email" /></label>
        <label>手机号：<input v-model="form.phone" /></label>
        <button type="submit">保存</button>
        <button type="button" @click="editing = false">取消</button>
      </form>

      <p class="message">{{ message }}</p>
      <button class="logout" @click="logout">退出登录</button>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 600px;
  margin: 30px auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}
dl {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 12px;
}
dt {
  font-weight: bold;
}
dd {
  margin: 0;
}
label {
  display: block;
  margin: 10px 0;
}
input {
  width: 100%;
  padding: 6px;
  box-sizing: border-box;
}
button {
  margin: 8px 8px 8px 0;
  padding: 8px 15px;
  cursor: pointer;
}
.message {
  color: #2563eb;
}
.logout {
  color: #b91c1c;
}
</style>
