<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { request, clearToken } from '../utils/request.js'
import { useTask } from '../composables/useTask.js'
import Feedback from '../components/Feedback.vue'
import AppIcon from '../components/AppIcon.vue'
const router = useRouter(),
  profile = ref(null),
  editing = ref(false)
const form = ref({ nickname: '', email: '', phone: '' })
const { pending, error, success, run } = useTask()
const loggingOut = ref(false)
const displayName = computed(
  () => profile.value?.nickname || profile.value?.username || '校园用户',
)
const roles = { STUDENT: '学生', SYSTEM_ADMIN: '系统管理员', TEACHER: '教师' }
const joined = computed(() => {
  const date = new Date(profile.value?.created_at)
  return Number.isNaN(+date) ? '—' : date.toLocaleDateString('zh-CN')
})
async function load() {
  await run(async () => {
    profile.value = await request('/api/d1/users/me')
  })
}
function startEdit() {
  form.value = Object.fromEntries(
    ['nickname', 'email', 'phone'].map((key) => [
      key,
      profile.value[key] || '',
    ]),
  )
  error.value = success.value = ''
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  error.value = success.value = ''
}
async function save() {
  await run(async () => {
    profile.value = await request('/api/d1/users/me', {
      method: 'PATCH',
      body: { ...form.value },
    })
    editing.value = false
  }, '个人资料已保存')
}
async function logout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await request('/api/d1/auth/logout', { method: 'POST' })
  } catch {
    /* Local sign-out must also work when the service is unavailable. */
  } finally {
    clearToken()
    await router.replace('/login')
    loggingOut.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="profile-view">
    <div class="page-heading">
      <div>
        <p class="eyebrow">MY CAMPUS</p>
        <h1>个人中心</h1>
        <p class="muted">管理个人资料，让校园服务更懂你。</p>
      </div>
      <span class="page-stamp">我的校园 · 我的日常</span>
    </div>
    <Feedback :error="error" :success="success" />
    <div v-if="!profile" class="panel profile-empty">
      <AppIcon name="user" />
      <h2>{{ pending ? '正在加载个人资料…' : '暂时无法获取资料' }}</h2>
      <button v-if="!pending" class="button primary" @click="load">
        重新加载
      </button>
    </div>
    <div v-else class="profile-grid">
      <aside class="profile-summary panel">
        <div class="profile-cover"></div>
        <div class="avatar">{{ Array.from(displayName)[0] }}</div>
        <h2>{{ displayName }}</h2>
        <p class="muted">@{{ profile.username }}</p>
        <span
          class="account-status"
          :class="{ inactive: profile.status !== 'ACTIVE' }"
          ><span class="live-dot"></span
          >{{
            profile.status === 'ACTIVE'
              ? '账号正常'
              : profile.status === 'DISABLED'
                ? '账号已停用'
                : profile.status || '状态未知'
          }}</span
        >
        <div class="summary-divider"></div>
        <div class="summary-row">
          <span>账号 ID</span><strong>{{ profile.id || '—' }}</strong>
        </div>
        <div class="summary-row">
          <span>学院 ID</span><strong>{{ profile.college_id || '—' }}</strong>
        </div>
        <div class="summary-row">
          <span>加入时间</span><strong>{{ joined }}</strong>
        </div>
        <button
          class="button logout-button"
          :disabled="loggingOut || pending"
          @click="logout"
        >
          {{ loggingOut ? '正在退出…' : '退出登录' }}
        </button>
      </aside>
      <section class="panel profile-details">
        <div class="section-heading">
          <div>
            <h2>基本资料</h2>
            <p class="muted">你的联系方式与账号信息</p>
          </div>
          <button
            v-if="!editing"
            class="button subtle"
            :disabled="pending || loggingOut"
            @click="startEdit"
          >
            编辑资料 <span aria-hidden="true">↗</span>
          </button>
        </div>
        <form v-if="editing" @submit.prevent="save">
          <fieldset :disabled="pending || loggingOut">
            <div class="form-grid">
              <label
                >昵称<input
                  v-model="form.nickname"
                  autocomplete="nickname"
                  maxlength="50"
                  placeholder="请输入昵称" /></label
              ><label
                >邮箱<input
                  v-model="form.email"
                  type="email"
                  autocomplete="email"
                  maxlength="100"
                  placeholder="请输入邮箱" /></label
              ><label
                >手机号<input
                  v-model="form.phone"
                  type="tel"
                  autocomplete="tel"
                  maxlength="20"
                  placeholder="请输入手机号"
              /></label>
            </div>
            <div class="form-actions">
              <button class="button primary" type="submit">
                {{ pending ? '保存中…' : '保存修改' }}</button
              ><button
                class="button subtle"
                type="button"
                @click="cancelEdit"
              >
                取消
              </button>
            </div>
          </fieldset>
        </form>
        <dl v-else class="profile-fields">
          <div>
            <dt>用户名</dt>
            <dd>{{ profile.username }}</dd>
          </div>
          <div>
            <dt>昵称</dt>
            <dd>{{ profile.nickname || '未填写' }}</dd>
          </div>
          <div>
            <dt>邮箱地址</dt>
            <dd>{{ profile.email || '未填写' }}</dd>
          </div>
          <div>
            <dt>手机号码</dt>
            <dd>{{ profile.phone || '未填写' }}</dd>
          </div>
          <div class="wide">
            <dt>当前角色</dt>
            <dd class="role-list">
              <span
                v-for="role in profile.roles || []"
                :key="role"
                class="role-tag"
                >{{ roles[role] || role }}</span
              ><span v-if="!profile.roles?.length">暂无角色</span>
            </dd>
          </div>
        </dl>
        <div class="profile-tip">
          <AppIcon name="user" />
          <p>保持联系方式准确，方便接收与你相关的校园服务信息。</p>
        </div>
      </section>
    </div>
  </div>
</template>
