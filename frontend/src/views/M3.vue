<script setup>
import { ref, onMounted } from "vue";
import { request } from "../utils/request.js";
const types = ref([]),
  tickets = ref([]),
  detail = ref(null),
  progress = ref([]),
  message = ref(""),
  busy = ref(false),
  me = ref(null);
const form = ref({
  repair_type_id: "1",
  classroom_id: "",
  location_description: "",
  description: "",
});
const manager = () =>
  (me.value?.roles.includes("SYSTEM_ADMIN")||me.value?.permissions?.includes("repair:manage"));
async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    await fn();
  } catch (e) {
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function load() {
  tickets.value = (
    await request(
      manager() || me.value?.permissions?.includes("repair:work")
        ? "/api/m3/tickets"
        : "/api/m3/tickets/me",
    )
  ).items;
}
async function select(t) {
  detail.value = await request("/api/m3/tickets/" + t.id);
  progress.value = await request("/api/m3/tickets/" + t.id + "/progress");
}
async function create() {
  await run(async () => {
    const body = { ...form.value };
    if (!body.classroom_id) delete body.classroom_id;
    await request("/api/m3/tickets", { method: "POST", body });
    message.value = "报修已提交";
    await load();
  });
}
async function act(action) {
  await run(async () => {
    let body = {};
    if (action === "assign") {
      const value = prompt("维修工用户 ID");
      if (!value) return;
      body.worker_id = value;
    }
    if (action === "progress" || action === "finish") {
      const value = prompt("维修进度说明");
      if (value === null) return;
      body.description = value;
    }
    if (action === "accept") {
      body.accepted = confirm("验收是否通过？确定表示通过，取消表示返工");
      if (!body.accepted) {
        body.comment = prompt("返工原因");
        if (!body.comment) return;
      }
    }
    if (action === "review") {
      body.rating = Number(prompt("评分（1–5）"));
      body.comment = prompt("评价内容") || "";
    }
    await request(`/api/m3/tickets/${detail.value.id}/${action}`, {
      method: "POST",
      body,
    });
    await select(detail.value);
    await load();
  });
}
onMounted(() =>
  run(async () => {
    me.value = await request("/api/d1/users/me");
    types.value = await request("/api/m3/repair-types");
    await load();
  }),
);
</script>
<template>
  <main>
    <h1>物业报修</h1>
    <p role="alert">{{ message }}</p>
    <form @submit.prevent="create">
      <h2>提交故障</h2>
      <label
        >故障类型<select v-model="form.repair_type_id">
          <option v-for="t in types" :key="t.id" :value="t.id">
            {{ t.type_name }}
          </option>
        </select></label
      ><label>教室 ID（选填）<input v-model="form.classroom_id" /></label
      ><label
        >故障位置<input
          required
          maxlength="255"
          v-model="form.location_description" /></label
      ><label
        >故障描述<textarea
          required
          v-model="form.description"
        ></textarea></label
      ><button :disabled="busy">提交报修</button>
    </form>
    <section>
      <h2>工单记录</h2>
      <button :disabled="busy" @click="run(load)">刷新</button>
      <p v-if="!tickets.length">暂无工单</p>
      <article v-for="t in tickets" :key="t.id">
        <button @click="run(() => select(t))">
          {{ t.location_description }} · {{ t.status }}
        </button>
      </article>
    </section>
    <section v-if="detail">
      <h2>工单详情</h2>
      <p>{{ detail.description }}</p>
      <p>
        状态：{{ detail.status }} · 优先级：{{ detail.priority }} ·
        同步待处理：{{ Boolean(detail.sync_pending) }}
      </p>
      <template v-if="!busy"
        ><button
          v-if="
            manager() &&
            ['PENDING_ASSIGNMENT', 'ASSIGNED'].includes(detail.status)
          "
          @click="act('assign')"
        >
          派单</button
        ><template v-if="detail.assigned_to === me?.id"
          ><button v-if="detail.status === 'ASSIGNED'" @click="act('start')">
            开始维修</button
          ><template v-if="detail.status === 'IN_PROGRESS'"
            ><button @click="act('progress')">更新进度</button
            ><button @click="act('finish')">提交完工</button></template
          ></template
        ><template v-if="detail.reporter_id === me?.id"
          ><button
            v-if="detail.status === 'PENDING_ACCEPTANCE'"
            @click="act('accept')"
          >
            验收</button
          ><button v-if="detail.status === 'COMPLETED'" @click="act('review')">
            评价</button
          ><button
            v-if="detail.status === 'PENDING_ASSIGNMENT'"
            @click="act('cancel')"
          >
            取消报修
          </button></template
        ></template
      >
      <ol>
        <li v-for="p in progress" :key="p.id">
          {{ p.created_at }} · {{ p.action_type }} · {{ p.description }}
        </li>
      </ol>
    </section>
  </main>
</template>
<style scoped>
main {
  max-width: 1000px;
  margin: 24px auto;
}
form,
section {
  padding: 24px;
  margin: 16px 0;
  border: 1px solid #ddd;
  border-radius: 12px;
}
label {
  display: block;
  margin: 12px 0;
}
input,
select,
textarea {
  display: block;
  width: 100%;
  padding: 8px;
}
button {
  margin: 6px;
  padding: 8px 16px;
}
</style>
