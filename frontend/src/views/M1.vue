<script setup>
import { ref, watch, nextTick } from "vue";
import AppIcon from "../components/AppIcon.vue";
import Feedback from "../components/Feedback.vue";
import { m1Api } from "../api/m1.js";
import { useM1Booking } from "../composables/useM1Booking.js";
import { formatCampusTime, socketLabels } from "../utils/m1.js";
import PersonalBookings from "../components/m1/PersonalBookings.vue";
import AdminPanel from "../components/m1/AdminPanel.vue";
import { useM1Personal } from "../composables/useM1Personal.js";
let refreshSeats = async () => true;
const personal = useM1Personal(m1Api, () => refreshSeats());
const { filters, state, stale, search, select, confirmBooking } = useM1Booking(
  m1Api,
  { refreshRecords: personal.refreshBookings },
);
refreshSeats = () => {
  state.success = "";
  return state.snapshot ? search() : Promise.resolve(true);
};
const dialog = ref(null);
const resultsHeading = ref(null);
watch(
  () => state.selected,
  async (selected) => {
    await nextTick();
    if (selected && !dialog.value?.open) dialog.value?.showModal();
    if (!selected && dialog.value?.open) {
      dialog.value.close();
      await nextTick();
      if (document.activeElement === document.body)
        resultsHeading.value?.focus();
    }
  },
);
function closeDialog(event) {
  if (state.bookingPending) {
    event?.preventDefault();
    return;
  }
  state.selected = null;
}
</script>

<template>
  <div class="m1">
    <header class="m1-heading">
      <div>
        <p class="m1-eyebrow">STUDY SPACE</p>
        <h1>为专注，留一个座位</h1>
        <p class="m1-subtitle">选好时间与座位，开始你的下一段学习。</p>
      </div>
      <div class="m1-rule">
        <AppIcon name="seat" /><span
          >整点预约<strong>{{ state.maxHours === null ? "时长上限以查询时配置为准" : `单次最多 ${state.maxHours} 小时` }}</strong></span
        >
      </div>
    </header>
    <section class="m1-panel" aria-labelledby="search-title">
      <div class="m1-section-title">
        <div>
          <h2 id="search-title">查找空闲座位</h2>
          <p>所有时间均为北京时间（UTC+08:00）</p>
        </div>
        <span class="m1-step">01 / 选择时段</span>
      </div>
      <form @submit.prevent="search" novalidate>
        <fieldset :disabled="state.bookingPending" class="m1-fields">
          <div class="m1-field">
            <label for="m1-start">开始时间</label
            ><input
              id="m1-start"
              v-model="filters.start"
              type="datetime-local"
              step="3600"
              required
            />
          </div>
          <div class="m1-field">
            <label for="m1-end">结束时间</label
            ><input
              id="m1-end"
              v-model="filters.end"
              type="datetime-local"
              step="3600"
              required
            />
          </div>
          <div class="m1-field">
            <label for="m1-building">教学楼 <span>选填</span></label
            ><input
              id="m1-building"
              v-model="filters.building"
              placeholder="输入教学楼名称"
            />
          </div>
          <div class="m1-field">
            <label for="m1-socket">插座类型</label
            ><select id="m1-socket" v-model="filters.socket_type">
              <option value="">不限插座类型</option>
              <option
                v-for="(label, value) in socketLabels"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select>
          </div>
          <div class="m1-field">
            <label for="m1-classroom">教室编号 <span>选填</span></label
            ><input
              id="m1-classroom"
              v-model="filters.classroom_id"
              inputmode="numeric"
              placeholder="输入教室编号"
            />
          </div>
          <div class="m1-field">
            <label for="m1-college">学院编号 <span>选填</span></label
            ><input
              id="m1-college"
              v-model="filters.college_id"
              inputmode="numeric"
              placeholder="输入学院编号"
            />
          </div>
        </fieldset>
        <div class="m1-form-footer">
          <p>预约时长按整点计算，请选择合适的学习时段。</p>
          <button
            class="m1-primary"
            type="submit"
            :disabled="state.searching || state.bookingPending"
          >
            {{ state.searching ? "查询中…" : "查询座位" }}
          </button>
        </div>
        <Feedback :error="state.searchError" />
      </form>
    </section>
    <section
      class="m1-results"
      aria-labelledby="results-title"
      :aria-busy="state.searching"
    >
      <div class="m1-section-title">
        <div>
          <h2 id="results-title" ref="resultsHeading" tabindex="-1">
            可预约座位
            <span v-if="state.searched && !stale" class="m1-count">{{
              state.seats.length
            }}</span>
          </h2>
          <p v-if="state.snapshot">
            {{ formatCampusTime(state.snapshot.params.start_time) }} —
            {{ formatCampusTime(state.snapshot.params.end_time) }}
          </p>
          <p v-else>查询后，在这里选择适合你的座位。</p>
        </div>
        <span class="m1-step">02 / 选择座位</span>
      </div>
      <Feedback :success="state.success" /><Feedback
        :error="state.bookingError"
      />
      <p v-if="stale" class="m1-notice" role="status">
        筛选条件已变化，请重新查询后预约。
      </p>
      <div v-if="state.searching" class="m1-empty" role="status">
        <AppIcon name="seat" />
        <h3>正在查找空闲座位</h3>
        <p>请稍候，查询结果即将显示。</p>
      </div>
      <div v-else-if="!state.searched" class="m1-empty">
        <AppIcon name="seat" />
        <h3>
          {{
            state.searchError ? "暂时无法显示座位" : "你的专注时光，从这里开始"
          }}
        </h3>
        <p>
          {{
            state.searchError
              ? "请查看上方提示，调整条件或重新查询。"
              : "先选择学习时间，再点击“查询座位”。"
          }}
        </p>
      </div>
      <div v-else-if="!state.seats.length" class="m1-empty">
        <AppIcon name="seat" />
        <h3>暂无符合条件的座位</h3>
        <p>试试其他时段，或减少筛选条件。</p>
      </div>
      <div v-else class="m1-seat-grid">
        <article
          v-for="seat in state.seats"
          :key="seat.seat_id"
          class="m1-seat"
          :class="{ 'm1-unavailable': stale || seat.available !== true }"
        >
          <div class="m1-seat-top">
            <span class="m1-seat-icon"><AppIcon name="seat" /></span
            ><span class="m1-badge">{{
              stale
                ? "待重新查询"
                : seat.available === true
                  ? "可预约"
                  : "不可预约"
            }}</span>
          </div>
          <h3>座位 {{ seat.seat_number || seat.seat_id }}</h3>
          <p class="m1-location">
            {{ seat.building || "教学楼未提供" }} ·
            {{ seat.room_number || `教室 ${seat.classroom_id}` }}
          </p>
          <div class="m1-seat-bottom">
            <span>{{ socketLabels[seat.socket_type] || "插座信息未提供" }}</span
            ><button
              class="m1-secondary"
              :disabled="
                stale ||
                seat.available !== true ||
                state.bookingPending ||
                !seat.seat_id
              "
              @click="select(seat)"
              :aria-label="`预约座位 ${seat.seat_number || seat.seat_id}`"
            >
              预约
            </button>
          </div>
        </article>
      </div>
    </section>
    <PersonalBookings :model="personal" />
    <AdminPanel />
    <dialog
      ref="dialog"
      class="m1-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-description"
      @cancel="closeDialog"
      @close="closeDialog"
    >
      <template v-if="state.selected"
        ><p class="m1-eyebrow">READY TO FOCUS</p>
        <h2 id="confirm-title">确认你的学习时段</h2>
        <p id="confirm-description" class="m1-muted">
          请核对座位和时间，预约成功后记得按时签到。
        </p>
        <dl>
          <dt>座位</dt>
          <dd>
            {{ state.selected.seat.building }} ·
            {{
              state.selected.seat.room_number ||
              `教室 ${state.selected.seat.classroom_id}`
            }}
            ·
            {{ state.selected.seat.seat_number || state.selected.seat.seat_id }}
          </dd>
          <dt>开始时间</dt>
          <dd>
            {{
              formatCampusTime(state.selected.query.params.start_time)
            }}（北京时间）
          </dd>
          <dt>结束时间</dt>
          <dd>
            {{
              formatCampusTime(state.selected.query.params.end_time)
            }}（北京时间）
          </dd>
        </dl>
        <Feedback :error="state.bookingError" />
        <div class="m1-dialog-actions">
          <button
            class="m1-secondary"
            :disabled="state.bookingPending"
            @click="closeDialog"
          >
            返回选择</button
          ><button
            class="m1-primary"
            :disabled="state.bookingPending"
            @click="confirmBooking"
          >
            {{ state.bookingPending ? "正在预约…" : "确认预约" }}
          </button>
        </div>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.m1 {
  max-width: 1120px;
  margin: 0 auto;
  color: #253b36;
}
.m1-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  margin-bottom: 30px;
}
.m1-eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: #527d6e;
  font-weight: 650;
  margin: 0 0 12px;
}
.m1 h1 {
  font-size: 30px;
  line-height: 1.35;
  margin: 0 0 12px;
}
.m1-subtitle,
.m1-muted {
  color: #687a71;
  font-size: 14px;
  line-height: 1.7;
}
.m1-rule {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px 20px;
  border-left: 1px solid #d4dfd9;
  font-size: 12px;
  color: #687a71;
  flex-shrink: 0;
}
.m1-rule strong {
  display: block;
  margin-top: 6px;
  color: #315c4d;
  font-size: 14px;
}
.m1-panel {
  background: #fff;
  border: 1px solid #e1e8e3;
  border-radius: 16px;
  padding: 26px;
}
.m1-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 22px;
}
.m1 h2 {
  font-size: 19px;
  margin: 0;
}
.m1-section-title p {
  font-size: 12px;
  color: #687a71;
  margin: 7px 0 0;
}
.m1-step {
  font-size: 11px;
  color: #75877e;
  white-space: nowrap;
}
.m1-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.m1-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.m1-field label {
  font-size: 13px;
  font-weight: 600;
}
.m1-field label span {
  font-weight: 400;
  color: #74847b;
  font-size: 11px;
  margin-left: 6px;
}
.m1 input,
.m1 select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #dce5df;
  border-radius: 8px;
  background: #fbfcfb;
  color: #253b36;
  padding: 11px 12px;
  font: inherit;
  font-size: 14px;
  min-height: 44px;
}
.m1 input:focus-visible,
.m1 select:focus-visible {
  outline: 2px solid #256653;
  outline-offset: 2px;
}
.m1-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #edf1ee;
}
.m1-form-footer p {
  font-size: 12px;
  color: #687a71;
  margin: 0;
}
.m1 button {
  font: inherit;
  font-size: 13px;
  min-height: 42px;
  border-radius: 8px;
  padding: 10px 17px;
  cursor: pointer;
}
.m1 button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.m1-primary {
  background: #256653;
  border: 1px solid #256653;
  color: #fff;
  white-space: nowrap;
}
.m1-primary:hover:not(:disabled) {
  background: #1b5141;
}
.m1-secondary {
  background: #fff;
  border: 1px solid #d6e2da;
  color: #285c49;
  white-space: nowrap;
}
.m1-secondary:hover:not(:disabled) {
  background: #f0f6f2;
}
.m1-results {
  margin-top: 32px;
}
.m1-count {
  display: inline-block;
  margin-left: 6px;
  background: #e4eee7;
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 13px;
  color: #30634b;
}
.m1-empty {
  text-align: center;
  background: #f0f4f0;
  border: 1px dashed #d0ddd3;
  border-radius: 14px;
  padding: 40px 20px;
  color: #667d70;
}
.m1-empty svg {
  width: 32px;
  height: 32px;
  color: #628974;
}
.m1-empty h3 {
  font-size: 16px;
  color: #3d604d;
  margin: 15px 0 9px;
}
.m1-empty p {
  font-size: 13px;
  margin: 0;
  line-height: 1.7;
}
.m1-seat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.m1-seat {
  background: #fff;
  border: 1px solid #dce7de;
  border-radius: 14px;
  padding: 20px;
  min-width: 0;
}
.m1-seat-top,
.m1-seat-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.m1-seat-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #eef5ef;
  color: #386c50;
}
.m1-badge {
  font-size: 11px;
  color: #3d7055;
  background: #edf5ee;
  padding: 5px 8px;
  border-radius: 5px;
  white-space: nowrap;
}
.m1-seat h3 {
  font-size: 21px;
  margin: 21px 0 7px;
  overflow-wrap: anywhere;
}
.m1-location {
  font-size: 13px;
  color: #6b7b70;
  margin: 0;
  overflow-wrap: anywhere;
}
.m1-seat-bottom {
  border-top: 1px solid #edf1ed;
  margin-top: 22px;
  padding-top: 15px;
}
.m1-seat-bottom > span {
  font-size: 12px;
  color: #566f5d;
}
.m1-unavailable {
  background: #f6f7f5;
}
.m1-notice {
  padding: 14px 16px;
  background: #fff7e5;
  border: 1px solid #eddfb5;
  border-radius: 8px;
  font-size: 13px;
  color: #765e26;
}
.m1-records {
  margin-top: 30px;
}
.m1-record-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.m1-record-list li {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-top: 1px solid #edf1ee;
}
.m1-record-list li > div {
  flex: 1;
  min-width: 0;
}
.m1-record-list strong {
  display: block;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.m1-record-list div span {
  display: block;
  font-size: 12px;
  color: #687a71;
  margin-top: 6px;
}
.m1-text-button {
  background: none;
  border: 0;
  color: #536e5d;
}
.m1-dialog {
  border: 1px solid #dce5df;
  border-radius: 16px;
  padding: 28px;
  max-width: 460px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  color: #253b36;
}
.m1-dialog::backdrop {
  background: rgba(17, 38, 28, 0.4);
}
.m1-dialog dl {
  background: #f4f7f3;
  padding: 18px;
  border-radius: 10px;
}
.m1-dialog dt {
  font-size: 12px;
  color: #617b68;
  margin-top: 14px;
}
.m1-dialog dt:first-child {
  margin-top: 0;
}
.m1-dialog dd {
  margin: 5px 0 0;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.m1-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 25px;
}
@media (max-width: 1000px) {
  .m1-seat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .m1-rule {
    display: none;
  }
  .m1 h1 {
    font-size: 26px;
  }
}
@media (max-width: 560px) {
  .m1-heading {
    margin-bottom: 22px;
  }
  .m1 h1 {
    font-size: 23px;
  }
  .m1-panel {
    padding: 20px 16px;
  }
  .m1-fields {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .m1-step {
    display: none;
  }
  .m1-form-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .m1-seat-grid {
    grid-template-columns: 1fr;
  }
  .m1-record-list li {
    flex-wrap: wrap;
    gap: 9px;
  }
  .m1-record-list li > div {
    flex-basis: 100%;
  }
  .m1-dialog {
    padding: 22px;
  }
  .m1-subtitle {
    font-size: 13px;
  }
}
</style>
