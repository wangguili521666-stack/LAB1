<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { request } from '../utils/request.js'
import { useTask } from '../composables/useTask.js'
import Feedback from '../components/Feedback.vue'

const statuses = {
  PENDING_L1: '待一级审批',
  PENDING_L2: '待二级审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  CANCELLED: '已撤销',
}
const profile = ref(null)
const rooms = ref([])
const applications = ref([])
const applicationTotal = ref(0)
const pending = ref([])
const details = ref({})
const purposes = ref({})
const comments = ref({})
const filters = ref({
  collegeId: '',
  building: '',
  roomNumber: '',
  minCapacity: '',
  start: defaultStart(),
  end: defaultEnd(),
})
const searchTask = reactive(useTask())
const applyTask = reactive(useTask())
const mineTask = reactive(useTask())
const approvalTask = reactive(useTask())
const applyingId = ref('')

const roles = computed(() => profile.value?.roles || [])
const canApply = computed(() => roles.value.includes('TEACHER') || roles.value.includes('SYSTEM_ADMIN'))
const canApprove = computed(
  () => roles.value.includes('CLASSROOM_ADMIN') || roles.value.includes('SYSTEM_ADMIN'),
)

function defaultStart() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return toLocalInput(date)
}
function defaultEnd() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(11, 0, 0, 0)
  return toLocalInput(date)
}
function toLocalInput(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function toISO(value) {
  return new Date(value).toISOString()
}
function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(+date) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

async function loadProfile() {
  try {
    profile.value = await request('/api/d1/users/me')
  } catch {
    profile.value = null
  }
}
async function search() {
  await searchTask.run(async () => {
    const params = new URLSearchParams({
      start_time: toISO(filters.value.start),
      end_time: toISO(filters.value.end),
    })
    if (filters.value.collegeId.trim()) params.set('college_id', filters.value.collegeId.trim())
    if (filters.value.building.trim()) params.set('building', filters.value.building.trim())
    if (filters.value.roomNumber.trim()) params.set('room_number', filters.value.roomNumber.trim())
    if (filters.value.minCapacity !== '') params.set('min_capacity', String(filters.value.minCapacity))
    rooms.value = await request(`/api/m2/classrooms?${params}`)
  })
}
async function fetchMine() {
  const data = await request('/api/m2/applications/me')
  applications.value = data.items
  applicationTotal.value = data.total
}
async function fetchPending() {
  const data = await request('/api/m2/approvals/pending')
  pending.value = data.items
}
async function loadMine() {
  await mineTask.run(fetchMine)
}
async function loadPending() {
  if (!canApprove.value) return
  await approvalTask.run(fetchPending)
}
async function apply(room) {
  const purpose = (purposes.value[room.classroom_id] || '').trim()
  if (!purpose) {
    applyTask.error = '请填写申请用途'
    applyTask.success = ''
    return
  }
  applyingId.value = room.classroom_id
  const ok = await applyTask.run(async () => {
    await request('/api/m2/applications', {
      method: 'POST',
      body: {
        classroom_id: room.classroom_id,
        purpose,
        start_time: toISO(filters.value.start),
        end_time: toISO(filters.value.end),
      },
    })
    purposes.value[room.classroom_id] = ''
    await Promise.all([fetchMine(), search()])
  }, '申请已提交，等待一级审批')
  applyingId.value = ''
  return ok
}
async function toggleDetail(id) {
  if (details.value[id]) {
    details.value = { ...details.value, [id]: null }
    return
  }
  const data = await request(`/api/m2/applications/${id}`)
  details.value = { ...details.value, [id]: data.approvals }
}
async function cancel(id) {
  await mineTask.run(async () => {
    await request(`/api/m2/applications/${id}/cancel`, { method: 'POST' })
    await fetchMine()
  }, '申请已撤销')
}
async function decide(id, decision) {
  const comment = (comments.value[id] || '').trim()
  if (decision === 'reject' && !comment) {
    approvalTask.error = '驳回必须填写理由'
    approvalTask.success = ''
    return
  }
  await approvalTask.run(async () => {
    await request(`/api/m2/applications/${id}/${decision}`, {
      method: 'POST',
      body: { comment },
    })
    comments.value[id] = ''
    await fetchPending()
  }, decision === 'approve' ? '审批已通过' : '申请已驳回')
}

onMounted(async () => {
  await loadProfile()
  await loadMine()
  await loadPending()
})
</script>

<template>
  <div class="m2-view">
    <div class="page-heading">
      <div>
        <p class="eyebrow">CLASSROOMS</p>
        <h1>教室申请</h1>
        <p class="muted">查询可整间预约的教室，提交后由自习室管理员和系统管理员依次审批。</p>
      </div>
      <span class="page-stamp">两级审批 · 超时自动拒绝</span>
    </div>

    <section class="panel">
      <h2>查询教室</h2>
      <div class="form-grid">
        <label>学院 ID<small>选填</small><input v-model="filters.collegeId" inputmode="numeric" /></label>
        <label>教学楼<small>选填</small><input v-model="filters.building" maxlength="100" /></label>
        <label>教室编号<small>选填</small><input v-model="filters.roomNumber" maxlength="30" /></label>
        <label>最少容量<small>选填</small><input v-model="filters.minCapacity" type="number" min="0" /></label>
        <label>开始时间<input v-model="filters.start" type="datetime-local" required /></label>
        <label>结束时间<input v-model="filters.end" type="datetime-local" required /></label>
      </div>
      <button class="button primary" :disabled="searchTask.pending" @click="search">
        {{ searchTask.pending ? '查询中…' : '查询可预约教室' }}
      </button>
      <Feedback :error="searchTask.error" :success="searchTask.success" />
      <p v-if="profile && !canApply" class="muted hint">当前账号不能提交整教室申请。老师和系统管理员可以申请。</p>
      <p v-if="!searchTask.pending && !searchTask.error && rooms.length === 0" class="muted hint">尚未查询，或这个时间段没有符合条件的教室。</p>
      <article v-for="room in rooms" :key="room.classroom_id" class="record">
        <div>
          <strong>{{ room.building }} · {{ room.room_number }}</strong>
          <p>
            容量 {{ room.capacity }} · 学院 {{ room.college_id || '不限' }} ·
            {{ room.available ? '该时段可申请' : '该时段不可申请' }}
          </p>
        </div>
        <div class="record-action">
          <input v-model="purposes[room.classroom_id]" maxlength="255" placeholder="申请用途" :disabled="!room.available" />
          <button
            class="button primary"
            :disabled="!room.available || applyTask.pending"
            @click="apply(room)"
          >
            {{ applyTask.pending && applyingId === room.classroom_id ? '提交中…' : '提交申请' }}
          </button>
        </div>
      </article>
      <Feedback :error="applyTask.error" :success="applyTask.success" />
    </section>

    <section class="panel">
      <div class="section-row">
        <h2>我的申请</h2>
        <button class="button subtle" :disabled="mineTask.pending" @click="loadMine">刷新</button>
      </div>
      <Feedback :error="mineTask.error" :success="mineTask.success" />
      <p v-if="applications.length === 0" class="muted hint">还没有教室申请。</p>
      <article v-for="item in applications" :key="item.id" class="record">
        <div>
          <strong>教室 {{ item.classroom_id }} · {{ item.purpose }}</strong>
          <p>{{ formatWhen(item.start_time) }} – {{ formatWhen(item.end_time) }}</p>
          <p>截止 {{ formatWhen(item.approval_deadline) }}</p>
          <ul v-if="details[item.id]?.length" class="opinions">
            <li v-for="approval in details[item.id]" :key="approval.id">
              {{ approval.approval_level === 1 ? '一级' : '二级' }}{{ approval.decision === 'APPROVED' ? '通过' : '驳回' }}：{{ approval.comment || '无意见' }}
            </li>
          </ul>
        </div>
        <div class="record-action">
          <span class="status" :data-status="item.status">{{ statuses[item.status] || item.status }}</span>
          <button class="button subtle" @click="toggleDetail(item.id)">审批意见</button>
          <button
            v-if="item.status === 'PENDING_L1' || item.status === 'PENDING_L2'"
            class="button subtle"
            :disabled="mineTask.pending"
            @click="cancel(item.id)"
          >
            撤销
          </button>
        </div>
      </article>
      <p v-if="applicationTotal > applications.length" class="muted hint">共 {{ applicationTotal }} 条，当前显示最近 {{ applications.length }} 条。</p>
    </section>

    <section v-if="canApprove" class="panel">
      <div class="section-row">
        <h2>待我审批</h2>
        <button class="button subtle" :disabled="approvalTask.pending" @click="loadPending">刷新</button>
      </div>
      <Feedback :error="approvalTask.error" :success="approvalTask.success" />
      <p v-if="pending.length === 0" class="muted hint">没有待处理的申请。</p>
      <article v-for="item in pending" :key="item.application.id" class="record">
        <div>
          <strong>申请人 {{ item.application.applicant_id }} · 教室 {{ item.application.classroom_id }}</strong>
          <p>{{ item.application.purpose }}</p>
          <p>{{ formatWhen(item.application.start_time) }} – {{ formatWhen(item.application.end_time) }}</p>
          <p>{{ statuses[item.application.status] }} · 截止 {{ formatWhen(item.application.approval_deadline) }}</p>
        </div>
        <div class="record-action">
          <textarea v-model="comments[item.application.id]" maxlength="2000" placeholder="审批意见，驳回时必填"></textarea>
          <button class="button primary" :disabled="approvalTask.pending" @click="decide(item.application.id, 'approve')">通过</button>
          <button class="button subtle" :disabled="approvalTask.pending" @click="decide(item.application.id, 'reject')">驳回</button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.m2-view { display: flex; flex-direction: column; gap: 22px; }
.m2-view h1, .m2-view h2, .m2-view p { margin-top: 0; }
.m2-view h1 { margin-bottom: 8px; font-size: 29px; font-weight: 600; }
.m2-view h2 { margin-bottom: 18px; font-size: 18px; font-weight: 600; }
.panel { padding: 22px 24px; }
.m2-view label { display: block; margin-bottom: 16px; color: #4a5e53; font-size: 12px; font-weight: 500; }
.m2-view label small { margin-left: 6px; color: #9ba59f; font-weight: 400; }
.m2-view input, .m2-view textarea {
  display: block; width: 100%; margin-top: 8px; border: 1px solid #dfe6e0; border-radius: 7px;
  background: #fcfdfb; color: #2b4135; outline: none;
}
.m2-view input { height: 44px; padding: 0 12px; }
.m2-view textarea { min-height: 74px; padding: 10px 12px; resize: vertical; }
.m2-view input:focus, .m2-view textarea:focus { border-color: #6f9c84; box-shadow: 0 0 0 3px #2566530c; }
.hint { margin: 14px 0 0; }
.record {
  display: flex; justify-content: space-between; gap: 18px; margin-top: 14px; padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 10px;
}
.record p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.record-action { display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: min(280px, 42%); }
.section-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-row h2 { margin-bottom: 0; }
.status { align-self: flex-end; padding: 4px 8px; border-radius: 999px; background: #eef3ea; color: #3d684c; font-size: 12px; }
.status[data-status='REJECTED'], .status[data-status='CANCELLED'] { background: #f8eee9; color: #8d5b45; }
.status[data-status='APPROVED'] { background: #e5f2ea; color: #1f6a45; }
.opinions { margin: 8px 0 0; padding-left: 18px; color: #4d6258; font-size: 13px; }
.feedback { margin-top: 14px; }
@media (max-width: 720px) {
  .form-grid, .record { display: block; }
  .record-action { width: auto; margin-top: 12px; }
}
</style>
