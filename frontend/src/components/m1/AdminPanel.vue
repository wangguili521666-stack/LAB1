<script setup>
import { ref, watch, onMounted, nextTick } from "vue";
import Feedback from "../Feedback.vue";
import { m1Api } from "../../api/m1.js";
import { getToken } from "../../utils/request.js";
import { useM1Admin } from "../../composables/useM1Admin.js";
import { statisticLabels } from "../../utils/m1Admin.js";
import { formatRecordTime, statusLabels } from "../../utils/m1.js";
const {
  access,
  canRead,
  canWrite,
  filters,
  statFilters,
  records,
  stats,
  settings,
  loadAccess,
  loadRecords,
  loadStatistics,
  loadSettings,
  editSetting,
  closeEdit,
  saveSetting,
} = useM1Admin(m1Api, getToken);
const expanded = ref(false),
  active = ref("bookings"),
  dialog = ref(null),
  settingsHeading = ref(null);
onMounted(() => {
  if (getToken()) loadAccess();
});
watch(canRead, (value) => {
  if (!value) expanded.value = false;
});
watch(canWrite, (value) => {
  if (!value && active.value === "settings") active.value = "bookings";
});
async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && !records.loaded) await loadRecords();
}
function tab(name) {
  active.value = name;
  if (name === "bookings" && !records.loaded) loadRecords();
  if (name === "statistics" && !stats.data) loadStatistics();
  if (name === "settings" && !settings.loaded) loadSettings();
}
watch(
  () => settings.edit,
  async (value) => {
    await nextTick();
    if (value && !dialog.value?.open) dialog.value?.showModal();
    if (!value && dialog.value?.open) {
      dialog.value.close();
      await nextTick();
      if (document.activeElement === document.body)
        settingsHeading.value?.focus();
    }
  },
);
function dismiss(event) {
  if (!closeEdit()) event?.preventDefault();
}
</script>

<template>
  <section
    v-if="access.loading || access.error || canRead"
    class="m1-admin"
    aria-labelledby="admin-title"
  >
    <header class="admin-heading">
      <div>
        <p class="admin-eyebrow">MANAGEMENT</p>
        <h2 id="admin-title">管理工作台</h2>
        <p>查看预约与统计，按授权范围管理自习资源。</p>
      </div>
      <button
        v-if="canRead"
        :aria-expanded="expanded"
        aria-controls="admin-content"
        @click="toggle"
      >
        {{ expanded ? "收起管理工作台" : "展开管理工作台" }}
      </button>
    </header>
    <p v-if="access.loading" role="status">正在确认管理权限…</p>
    <Feedback :error="access.error" /><button
      v-if="access.error"
      :disabled="access.loading"
      @click="loadAccess"
    >
      重新确认权限
    </button>
    <div v-if="canRead && expanded" id="admin-content">
      <nav class="admin-nav" aria-label="管理功能">
        <button :aria-pressed="active === 'bookings'" @click="tab('bookings')">
          预约管理</button
        ><button
          :aria-pressed="active === 'statistics'"
          @click="tab('statistics')"
        >
          预约统计</button
        ><button
          v-if="canWrite"
          :aria-pressed="active === 'settings'"
          @click="tab('settings')"
        >
          预约配置</button
        ><span>{{ canWrite ? "系统管理员" : "只读管理" }}</span>
      </nav>
      <section
        v-if="active === 'bookings'"
        aria-labelledby="admin-bookings-title"
      >
        <h3 id="admin-bookings-title">预约查询</h3>
        <p class="admin-muted">
          按预约开始时间筛选，均为北京时间；结束日期当天不计入区间。可留空日期查询全部时段。
        </p>
        <form class="admin-form" @submit.prevent="loadRecords(1)" novalidate>
          <label for="admin-start"
            >开始日期（含）<input
              id="admin-start"
              v-model="filters.start"
              type="date" /></label
          ><label for="admin-end"
            >结束日期（不含）<input
              id="admin-end"
              v-model="filters.end"
              type="date" /></label
          ><label for="admin-room"
            >教室编号<input
              id="admin-room"
              v-model="filters.classroom_id"
              inputmode="numeric"
              placeholder="不限教室" /></label
          ><label for="admin-status"
            >预约状态<select id="admin-status" v-model="filters.status">
              <option value="">全部状态</option>
              <option
                v-for="(label, status) in statusLabels"
                :key="status"
                :value="status"
              >
                {{ label }}
              </option>
            </select></label
          ><button class="admin-primary" :disabled="records.loading">
            {{ records.loading ? "查询中…" : "查询管理预约" }}
          </button>
        </form>
        <Feedback :error="records.error" />
        <p v-if="records.loading" role="status" class="admin-muted">
          正在读取预约…
        </p>
        <p v-else-if="!records.loaded && !records.error" class="admin-empty">
          点击查询查看当前条件下的预约。
        </p>
        <p v-if="records.loaded" class="admin-muted">
          共 {{ records.total }} 条预约 · 仅展示账号有权访问的数据
        </p>
        <p v-if="records.loaded && !records.items.length" class="admin-empty">
          暂无符合条件的预约。
        </p>
        <ul class="admin-records">
          <li v-for="item in records.items" :key="item.id">
            <div>
              <strong>预约 {{ item.id }}</strong
              ><span
                >用户编号 {{ item.user_id ?? "未提供" }} · 座位编号
                {{ item.seat_id }}</span
              ><small
                >{{ formatRecordTime(item.start_time) }} —
                {{ formatRecordTime(item.end_time) }}</small
              >
            </div>
            <span class="admin-badge">{{
              statusLabels[item.status] || "未知状态"
            }}</span>
          </li>
        </ul>
        <nav
          v-if="records.total > records.page_size"
          class="admin-pagination"
          aria-label="管理预约分页"
        >
          <button
            :disabled="records.loading || records.page <= 1"
            @click="loadRecords(records.page - 1)"
          >
            上一页</button
          ><span
            >第 {{ records.page }} /
            {{ Math.ceil(records.total / records.page_size) }} 页</span
          ><button
            :disabled="
              records.loading ||
              records.page * records.page_size >= records.total
            "
            @click="loadRecords(records.page + 1)"
          >
            下一页
          </button>
        </nav>
      </section>
      <section
        v-if="active === 'statistics'"
        aria-labelledby="admin-stat-title"
      >
        <h3 id="admin-stat-title">预约统计</h3>
        <p class="admin-muted">
          按预约开始时间落在所选区间统计；含开始、不含结束，均为北京时间。
        </p>
        <form class="admin-form" @submit.prevent="loadStatistics" novalidate>
          <label for="stat-start"
            >开始日期（含）<input
              id="stat-start"
              v-model="statFilters.start"
              type="date"
              required /></label
          ><label for="stat-end"
            >结束日期（不含）<input
              id="stat-end"
              v-model="statFilters.end"
              type="date"
              required /></label
          ><label for="stat-room"
            >教室编号<input
              id="stat-room"
              v-model="statFilters.classroom_id"
              inputmode="numeric"
              placeholder="不限教室" /></label
          ><button class="admin-primary" :disabled="stats.loading">
            {{ stats.loading ? "统计中…" : "查询统计" }}
          </button>
        </form>
        <Feedback :error="stats.error" />
        <p v-if="stats.loading" role="status" class="admin-muted">
          正在读取统计…
        </p>
        <p v-else-if="!stats.data && !stats.error" class="admin-empty">
          选择日期范围后查询统计。
        </p>
        <template v-if="stats.data"
          ><p class="admin-muted">
            统计区间：{{ formatRecordTime(stats.query.start_time) }} 至
            {{ formatRecordTime(stats.query.end_time) }}（结束时刻不计入）
          </p>
          <div class="admin-metrics">
            <article v-for="(label, key) in statisticLabels" :key="key">
              <h4>{{ label }}</h4>
              <strong :data-metric="key">{{
                stats.data[key] === null ? "—" : stats.data[key]
              }}</strong
              ><span>{{
                stats.data[key] === null ? "系统未提供" : "条预约"
              }}</span>
            </article>
          </div>
          <p
            v-if="Object.values(stats.data).some((value) => value === null)"
            class="admin-note"
          >
            部分统计数据未提供，不能视为零。
          </p>
          <p class="admin-muted">
            已预约、已签到也可能计入预约总数，以下三类状态之和不一定等于总数。
          </p></template
        >
      </section>
      <section
        v-if="active === 'settings' && canWrite"
        aria-labelledby="admin-settings-title"
      >
        <div class="admin-section-heading">
          <h3 id="admin-settings-title" ref="settingsHeading" tabindex="-1">
            预约参数配置
          </h3>
          <button
            :disabled="settings.loading || settings.saving"
            @click="loadSettings"
          >
            刷新配置
          </button>
        </div>
        <p class="admin-note">
          当前学生端仍按 4 小时校验预约时长。配置联动将在后端联调确认后启用。
        </p>
        <p class="admin-muted">
          仅编辑系统已有的配置项，参数含义与合法值请按小组约定填写；保存时由系统再次校验。
        </p>
        <Feedback :success="settings.success" /><Feedback
          :error="settings.error"
        />
        <p v-if="settings.loading" role="status">正在读取配置…</p>
        <p
          v-if="
            settings.loaded &&
            !settings.loading &&
            !settings.items.length &&
            !settings.error
          "
          class="admin-empty"
        >
          系统尚未返回可配置的参数。
        </p>
        <ul class="admin-settings">
          <li v-for="item in settings.items" :key="item.setting_key">
            <div>
              <strong>{{ item.setting_key }}</strong
              ><span>当前值：{{ item.setting_value || "（空值）" }}</span
              ><small>更新时间：{{ formatRecordTime(item.updated_at) }}</small>
            </div>
            <button
              :disabled="
                settings.loading || settings.saving || !!settings.error
              "
              @click="editSetting(item.setting_key)"
              :aria-label="`编辑配置 ${item.setting_key}`"
            >
              编辑
            </button>
          </li>
        </ul>
      </section>
    </div>
    <dialog
      ref="dialog"
      class="admin-dialog"
      aria-labelledby="setting-edit-title"
      @cancel="dismiss"
      @close="dismiss"
    >
      <template v-if="settings.edit"
        ><h3 id="setting-edit-title">确认修改预约配置</h3>
        <p class="admin-muted">配置项：{{ settings.edit.key }}</p>
        <p>原值：{{ settings.edit.original || "（空值）" }}</p>
        <form @submit.prevent="saveSetting">
          <label for="setting-value"
            >新值<textarea
              id="setting-value"
              v-model="settings.edit.value"
              :disabled="settings.saving"
              rows="3"
            ></textarea>
          </label>
          <p class="admin-muted">只修改此配置项；其他参数保持原值。</p>
          <Feedback :error="settings.edit.error" />
          <div class="admin-dialog-actions">
            <button type="button" :disabled="settings.saving" @click="dismiss">
              返回</button
            ><button
              type="submit"
              class="admin-primary"
              :disabled="settings.saving"
            >
              {{ settings.saving ? "保存中…" : "确认保存" }}
            </button>
          </div>
        </form></template
      >
    </dialog>
  </section>
</template>

<style scoped>
.m1-admin {
  margin-top: 32px;
  padding: 28px;
  border: 1px solid #cdded2;
  border-radius: 16px;
  background: #fff;
  color: #253b36;
}
.admin-heading,
.admin-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
}
.admin-heading h2 {
  font-size: 20px;
  margin: 0;
}
.admin-heading p:not(.admin-eyebrow) {
  font-size: 13px;
  color: #687a71;
}
.admin-eyebrow {
  font-size: 11px;
  letter-spacing: 1.8px;
  color: #527d6e;
  margin: 0 0 10px;
}
.m1-admin button {
  min-height: 42px;
  padding: 10px 15px;
  border: 1px solid #d6e2da;
  border-radius: 8px;
  background: #fff;
  color: #285c49;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.m1-admin button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.m1-admin .admin-primary {
  background: #256653;
  border-color: #256653;
  color: #fff;
}
.admin-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  border-top: 1px solid #e5eee7;
  border-bottom: 1px solid #e5eee7;
  padding: 18px 0;
  margin-top: 15px;
}
.admin-nav [aria-pressed="true"] {
  background: #e8f1e9;
  border-color: #91b59d;
  font-weight: 600;
}
.admin-nav span {
  margin-left: auto;
  color: #58705e;
  font-size: 12px;
}
.m1-admin h3 {
  font-size: 17px;
  margin: 24px 0 12px;
}
.admin-muted {
  font-size: 13px;
  line-height: 1.8;
  color: #687a71;
}
.admin-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: end;
  margin: 20px 0;
}
.admin-form label,
.admin-dialog label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.m1-admin input,
.m1-admin select,
.m1-admin textarea {
  font: inherit;
  font-size: 14px;
  color: #253b36;
  background: #fbfcfb;
  border: 1px solid #d6e2da;
  border-radius: 8px;
  padding: 11px;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.m1-admin input:focus-visible,
.m1-admin select:focus-visible,
.m1-admin textarea:focus-visible {
  outline: 2px solid #256653;
  outline-offset: 2px;
}
.admin-form button {
  justify-self: start;
  min-width: 140px;
}
.admin-records,
.admin-settings {
  list-style: none;
  margin: 0;
  padding: 0;
}
.admin-records li,
.admin-settings li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  border-top: 1px solid #e8eee9;
}
.admin-records li > div,
.admin-settings li > div {
  min-width: 0;
}
.admin-records strong,
.admin-settings strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.admin-records span:not(.admin-badge),
.admin-settings span {
  display: block;
  margin-top: 7px;
  font-size: 13px;
  color: #5c7363;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.admin-records small,
.admin-settings small {
  display: block;
  margin-top: 7px;
  font-size: 12px;
  color: #738277;
}
.admin-badge {
  padding: 6px 9px;
  border-radius: 5px;
  background: #edf5ee;
  font-size: 12px;
  white-space: nowrap;
  color: #356549;
}
.admin-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
  font-size: 13px;
}
.admin-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 22px 0;
}
.admin-metrics article {
  padding: 22px 16px;
  background: #f2f6ef;
  border-radius: 10px;
}
.admin-metrics h4 {
  font-size: 13px;
  font-weight: 500;
  color: #5c7363;
  margin: 0;
}
.admin-metrics strong {
  display: block;
  font-size: 32px;
  color: #285c49;
  margin: 18px 0 8px;
  overflow-wrap: anywhere;
}
.admin-metrics span {
  font-size: 12px;
  color: #687a71;
}
.admin-note {
  background: #fff7e8;
  border: 1px solid #eadfbe;
  border-radius: 8px;
  padding: 14px;
  color: #75602d;
  font-size: 13px;
  line-height: 1.8;
}
.admin-empty {
  padding: 26px;
  text-align: center;
  font-size: 14px;
  color: #687a71;
  background: #f5f8f3;
  border-radius: 8px;
}
.admin-dialog {
  max-width: 500px;
  width: calc(100% - 32px);
  padding: 26px;
  border: 1px solid #d6e2da;
  border-radius: 16px;
  box-sizing: border-box;
  color: #253b36;
}
.admin-dialog::backdrop {
  background: rgba(17, 38, 28, 0.4);
}
.admin-dialog h3 {
  margin-top: 0;
}
.admin-dialog p {
  overflow-wrap: anywhere;
  font-size: 13px;
}
.admin-dialog textarea {
  resize: vertical;
}
.admin-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}
@media (max-width: 700px) {
  .admin-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .m1-admin {
    padding: 20px 16px;
  }
  .admin-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .admin-form {
    grid-template-columns: 1fr;
  }
  .admin-form button {
    width: 100%;
  }
  .admin-nav span {
    flex-basis: 100%;
    margin-left: 0;
  }
  .admin-records li {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .admin-settings li {
    align-items: flex-start;
  }
  .admin-metrics {
    gap: 10px;
  }
  .admin-metrics article {
    padding: 16px 12px;
  }
  .admin-dialog {
    padding: 20px;
  }
  .admin-pagination {
    justify-content: center;
    gap: 8px;
  }
}
</style>
