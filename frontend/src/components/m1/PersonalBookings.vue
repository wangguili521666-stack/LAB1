<script setup>
import { ref, watch, nextTick, onMounted } from "vue";
import Feedback from "../Feedback.vue";
import {
  formatRecordTime as formatCampusTime,
  statusLabels,
} from "../../utils/m1.js";
const props = defineProps({ model: { type: Object, required: true } });
const {
  bookings,
  violations,
  state,
  refreshBookings,
  setStatus,
  setPage,
  refreshViolations,
  open,
  close,
  submit,
} = props.model;
const dialog = ref(null),
  recordsHeading = ref(null),
  codeInput = ref(null),
  startInput = ref(null);
const titles = {
  detail: "预约详情",
  cancel: "确认取消预约",
  checkin: "输入签到码",
  rebook: "再次预约这个座位",
};
const actions = {
  cancel: "确认取消",
  checkin: "确认签到",
  rebook: "确认再次预约",
};
watch(
  () => state.dialog,
  async (value) => {
    await nextTick();
    if (value && !dialog.value.open) dialog.value.showModal();
    if (!value && dialog.value.open) {
      dialog.value.close();
      await nextTick();
      if (document.activeElement === document.body)
        recordsHeading.value?.focus();
    }
  },
);
watch(
  () => state.dialog?.loading,
  async (loading) => {
    if (loading === false) {
      await nextTick();
      if (state.dialog?.kind === "checkin") codeInput.value?.focus();
      if (state.dialog?.kind === "rebook") startInput.value?.focus();
    }
  },
);
function dismiss(event) {
  if (!close()) event?.preventDefault();
}
onMounted(refreshBookings);
</script>

<template>
  <div class="m1-personal">
    <section
      class="personal-panel"
      aria-labelledby="records-title"
      :aria-busy="bookings.loading"
    >
      <header class="personal-header">
        <div>
          <p class="personal-eyebrow">MY RESERVATIONS</p>
          <h2 id="records-title" ref="recordsHeading" tabindex="-1">
            我的预约
          </h2>
          <p>管理学习时段，查看预约与历史记录。</p>
        </div>
        <button :disabled="bookings.loading" @click="refreshBookings">
          {{ bookings.loading ? "加载中…" : "刷新记录" }}
        </button>
      </header>
      <Feedback :success="state.success" /><Feedback
        :error="state.refreshWarning"
      />
      <div class="personal-toolbar">
        <label for="record-status"
          >预约状态
          <select
            id="record-status"
            :value="bookings.status"
            :disabled="state.pending"
            @change="setStatus($event.target.value)"
          >
            <option value="">全部状态</option>
            <option
              v-for="(label, status) in statusLabels"
              :key="status"
              :value="status"
            >
              {{ label }}
            </option>
          </select></label
        ><span v-if="bookings.loaded">共 {{ bookings.total }} 条</span>
      </div>
      <Feedback
        :error="bookings.error ? `记录加载失败：${bookings.error}` : ''"
      />
      <p v-if="bookings.loading" role="status" class="personal-muted">
        正在加载预约记录…
      </p>
      <p
        v-else-if="bookings.loaded && !bookings.items.length && !bookings.error"
        class="personal-empty"
      >
        {{
          bookings.status
            ? "该状态下暂无预约记录，试试其他状态。"
            : "暂无预约记录，先选择一个座位开始吧。"
        }}
      </p>
      <ul class="m1-record-list">
        <li
          v-for="record in bookings.items"
          :key="record.id"
          class="personal-record"
        >
          <div class="personal-record-info">
            <strong>座位编号 {{ record.seat_id }}</strong
            ><span
              >{{ formatCampusTime(record.start_time) }} —
              {{ formatCampusTime(record.end_time) }}</span
            ><small>预约编号 {{ record.id }} · 北京时间</small>
          </div>
          <span class="personal-badge" :data-status="record.status">{{
            statusLabels[record.status] || "未知状态"
          }}</span>
          <div class="personal-actions">
            <button
              :disabled="bookings.loading || state.pending"
              @click="open('detail', record.id)"
              :aria-label="`查看预约 ${record.id} 详情`"
            >
              详情</button
            ><template v-if="record.status === 'BOOKED'"
              ><button
                class="personal-primary"
                :disabled="bookings.loading || state.pending"
                @click="open('checkin', record.id)"
                :aria-label="`签到预约 ${record.id}`"
              >
                签到</button
              ><button
                :disabled="bookings.loading || state.pending"
                @click="open('cancel', record.id)"
                :aria-label="`取消预约 ${record.id}`"
              >
                取消预约
              </button></template
            ><button
              :disabled="bookings.loading || state.pending"
              @click="open('rebook', record.id)"
              :aria-label="`再次预约 ${record.id}`"
            >
              再次预约
            </button>
          </div>
        </li>
      </ul>
      <nav
        v-if="bookings.total > bookings.page_size"
        class="personal-pagination"
        aria-label="预约记录分页"
      >
        <button
          :disabled="bookings.loading || state.pending || bookings.page <= 1"
          @click="setPage(bookings.page - 1)"
        >
          上一页</button
        ><span
          >第 {{ bookings.page }} /
          {{
            Math.max(1, Math.ceil(bookings.total / bookings.page_size))
          }}
          页</span
        ><button
          :disabled="
            bookings.loading ||
            state.pending ||
            bookings.page * bookings.page_size >= bookings.total
          "
          @click="setPage(bookings.page + 1)"
        >
          下一页
        </button>
      </nav>
    </section>

    <section
      class="personal-panel"
      aria-labelledby="violations-title"
      :aria-busy="violations.loading"
    >
      <header class="personal-header">
        <div>
          <p class="personal-eyebrow">RESERVATION RECORD</p>
          <h2 id="violations-title">违约记录</h2>
          <p>未按时签到的记录以系统实际处理结果为准。</p>
        </div>
        <button :disabled="violations.loading" @click="refreshViolations()">
          {{
            violations.loading
              ? "加载中…"
              : violations.loaded
                ? "刷新违约记录"
                : "查看违约记录"
          }}
        </button>
      </header>
      <p class="personal-rule">
        请按时到达并输入教室现场签到码。预约开始后 15
        分钟仍未签到，系统将按规则释放座位并记录违约。
      </p>
      <Feedback :error="violations.error" />
      <p
        v-if="!violations.loaded && !violations.loading && !violations.error"
        class="personal-muted"
      >
        点击“查看违约记录”查询。
      </p>
      <p
        v-if="
          violations.loaded &&
          !violations.loading &&
          !violations.error &&
          !violations.items.length
        "
        class="personal-empty"
      >
        暂无违约记录，感谢你按时使用座位。
      </p>
      <ul class="personal-violations">
        <li v-for="item in violations.items" :key="item.id">
          <div>
            <strong>{{
              item.violation_type === "NO_SHOW"
                ? "未签到违约"
                : `违约类型：${item.violation_type}`
            }}</strong
            ><span>{{ formatCampusTime(item.occurred_at) }} · 北京时间</span
            ><small>记录编号 {{ item.id }}</small>
          </div>
          <button
            :disabled="state.pending"
            @click="open('detail', item.booking_id)"
          >
            查看关联预约 {{ item.booking_id }}
          </button>
        </li>
      </ul>
      <nav
        v-if="violations.total > violations.page_size"
        class="personal-pagination"
        aria-label="违约记录分页"
      >
        <button
          :disabled="violations.loading || violations.page <= 1"
          @click="refreshViolations(violations.page - 1)"
        >
          上一页</button
        ><span
          >第 {{ violations.page }} /
          {{ Math.ceil(violations.total / violations.page_size) }} 页</span
        ><button
          :disabled="
            violations.loading ||
            violations.page * violations.page_size >= violations.total
          "
          @click="refreshViolations(violations.page + 1)"
        >
          下一页
        </button>
      </nav>
    </section>

    <dialog
      ref="dialog"
      class="personal-dialog"
      aria-labelledby="personal-dialog-title"
      @cancel="dismiss"
      @close="dismiss"
    >
      <template v-if="state.dialog"
        ><header>
          <h2 id="personal-dialog-title">{{ titles[state.dialog.kind] }}</h2>
          <button
            aria-label="关闭预约弹窗"
            :disabled="state.pending"
            @click="dismiss"
          >
            关闭
          </button>
        </header>
        <p v-if="state.dialog.loading" role="status" class="personal-muted">
          正在读取最新预约信息…
        </p>
        <dl v-if="state.dialog.record">
          <dt>预约编号</dt>
          <dd>{{ state.dialog.id }}</dd>
          <dt>座位编号</dt>
          <dd>{{ state.dialog.record.seat_id }}</dd>
          <dt>预约时段（北京时间）</dt>
          <dd>
            {{ formatCampusTime(state.dialog.record.start_time) }} —
            {{ formatCampusTime(state.dialog.record.end_time) }}
          </dd>
          <dt>当前状态</dt>
          <dd>{{ statusLabels[state.dialog.record.status] || "未知状态" }}</dd>
          <template v-if="state.dialog.kind === 'detail'"
            ><dt>创建时间</dt>
            <dd>{{ formatCampusTime(state.dialog.record.created_at) }}</dd>
            <template v-if="state.dialog.record.cancelled_at"
              ><dt>取消时间</dt>
              <dd>
                {{ formatCampusTime(state.dialog.record.cancelled_at) }}
              </dd></template
            ></template
          >
        </dl>
        <form
          v-if="
            state.dialog.kind !== 'detail' &&
            state.dialog.record &&
            !state.dialog.unavailable
          "
          @submit.prevent="submit"
          novalidate
        >
          <p
            v-if="
              ['checkin', 'cancel'].includes(state.dialog.kind) &&
              state.dialog.record.status !== 'BOOKED'
            "
            class="personal-rule"
          >
            当前预约状态不支持此操作，请关闭弹窗并刷新记录。
          </p>
          <template v-else>
            <p v-if="state.dialog.kind === 'cancel'" class="personal-rule">
              取消后将释放本次预约的座位。是否允许取消，以系统校验结果为准。
            </p>
            <label
              v-if="state.dialog.kind === 'checkin'"
              class="personal-field"
              for="checkin-code"
              >教室签到码<input
                ref="codeInput"
                id="checkin-code"
                v-model="state.dialog.code"
                :disabled="state.pending"
                autocomplete="off"
                placeholder="输入教室现场显示的编码"
              /><small
                >请使用当前教室的有效编码，签到时间由系统校验。</small
              ></label
            >
            <div v-if="state.dialog.kind === 'rebook'" class="personal-rebook">
              <p class="personal-muted">
                请选择新的学习时段；原预约记录不会改变。北京时间，整点预约，单次最多
                4 小时。
              </p>
              <label class="personal-field" for="rebook-start"
                >新的开始时间<input
                  ref="startInput"
                  id="rebook-start"
                  v-model="state.dialog.start"
                  :disabled="state.pending"
                  type="datetime-local"
                  step="3600" /></label
              ><label class="personal-field" for="rebook-end"
                >新的结束时间<input
                  id="rebook-end"
                  v-model="state.dialog.end"
                  :disabled="state.pending"
                  type="datetime-local"
                  step="3600"
              /></label>
            </div>
            <div class="personal-dialog-actions">
              <button type="button" :disabled="state.pending" @click="dismiss">
                返回</button
              ><button
                type="submit"
                class="personal-primary"
                :disabled="state.pending"
              >
                {{ state.pending ? "提交中…" : actions[state.dialog.kind] }}
              </button>
            </div>
          </template>
        </form>
        <Feedback :error="state.dialog.error" />
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.m1-personal {
  margin-top: 30px;
  color: #253b36;
}
.personal-panel {
  background: #fff;
  border: 1px solid #e1e8e3;
  border-radius: 16px;
  padding: 26px;
  margin-top: 24px;
}
.personal-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
}
.personal-header h2,
.personal-dialog h2 {
  font-size: 19px;
  margin: 0;
}
.personal-header p:not(.personal-eyebrow) {
  font-size: 13px;
  color: #687a71;
  margin: 9px 0 0;
}
.personal-eyebrow {
  font-size: 10px;
  letter-spacing: 1.8px;
  color: #527d6e;
  margin: 0 0 8px;
}
.m1-personal button {
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid #d6e2da;
  border-radius: 8px;
  background: #fff;
  color: #285c49;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.m1-personal button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.m1-personal button.personal-primary {
  background: #256653;
  color: #fff;
  border-color: #256653;
}
.personal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 14px 0;
  border-top: 1px solid #edf1ee;
}
.personal-toolbar label,
.personal-toolbar > span {
  font-size: 13px;
}
.m1-personal select,
.m1-personal input {
  padding: 10px;
  border: 1px solid #d6e2da;
  border-radius: 8px;
  background: #fbfcfb;
  color: #253b36;
  min-height: 44px;
  box-sizing: border-box;
  font: inherit;
  font-size: 14px;
  min-width: 0;
}
.personal-toolbar select {
  margin-left: 8px;
}
.m1-personal select:focus-visible,
.m1-personal input:focus-visible {
  outline: 2px solid #256653;
  outline-offset: 2px;
}
.m1-record-list,
.personal-violations {
  list-style: none;
  padding: 0;
  margin: 0;
}
.personal-record {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
  border-top: 1px solid #edf1ee;
}
.personal-record-info {
  flex: 1;
  min-width: 180px;
}
.personal-record-info strong,
.personal-violations strong {
  font-size: 15px;
  display: block;
  overflow-wrap: anywhere;
}
.personal-record-info span,
.personal-violations span {
  font-size: 13px;
  display: block;
  color: #687a71;
  margin-top: 8px;
}
.personal-record-info small,
.personal-violations small {
  display: block;
  color: #738277;
  font-size: 11px;
  margin-top: 7px;
  overflow-wrap: anywhere;
}
.personal-badge {
  padding: 6px 9px;
  background: #edf5ee;
  color: #356549;
  border-radius: 5px;
  font-size: 12px;
  white-space: nowrap;
}
.personal-badge[data-status="NO_SHOW"] {
  background: #fbefdf;
  color: #865d25;
}
.personal-badge[data-status="CANCELLED"] {
  background: #f1f2f0;
  color: #687568;
}
.personal-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.personal-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  border-top: 1px solid #edf1ee;
  padding-top: 18px;
  font-size: 13px;
}
.personal-muted,
.personal-empty {
  font-size: 13px;
  color: #687a71;
  line-height: 1.8;
}
.personal-empty {
  padding: 24px 0;
  text-align: center;
}
.personal-rule {
  background: #f2f6ef;
  padding: 14px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: #53674f;
  line-height: 1.8;
}
.personal-violations li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  border-top: 1px solid #edf1ee;
}
.personal-dialog {
  width: calc(100% - 32px);
  max-width: 520px;
  border: 1px solid #d6e2da;
  border-radius: 16px;
  padding: 26px;
  box-sizing: border-box;
  color: #253b36;
}
.personal-dialog::backdrop {
  background: rgba(17, 38, 28, 0.4);
}
.personal-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.personal-dialog dl {
  padding: 18px;
  background: #f4f7f3;
  border-radius: 10px;
}
.personal-dialog dt {
  font-size: 12px;
  color: #617b68;
  margin-top: 14px;
}
.personal-dialog dt:first-child {
  margin-top: 0;
}
.personal-dialog dd {
  font-size: 14px;
  margin: 5px 0 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.personal-field {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 16px;
  font-size: 13px;
}
.personal-field small {
  color: #687a71;
  line-height: 1.6;
}
.personal-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
@media (max-width: 560px) {
  .personal-panel {
    padding: 20px 16px;
  }
  .personal-header {
    gap: 12px;
    align-items: flex-start;
  }
  .personal-header > button {
    flex-shrink: 0;
  }
  .personal-toolbar {
    flex-wrap: wrap;
  }
  .personal-record-info {
    flex-basis: 100%;
  }
  .personal-actions {
    flex-basis: 100%;
  }
  .personal-pagination {
    justify-content: center;
    gap: 8px;
  }
  .personal-violations li {
    align-items: flex-start;
    flex-direction: column;
  }
  .personal-dialog {
    padding: 20px;
  }
  .personal-toolbar select {
    max-width: 180px;
  }
}
</style>
