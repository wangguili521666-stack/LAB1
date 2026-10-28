import { reactive, onScopeDispose } from "vue";
import { buildSearch, defaultFilters, statusLabels } from "../utils/m1.js";

const makeList = () => ({
  items: [],
  page: 1,
  page_size: 20,
  total: 0,
  loaded: false,
  loading: false,
  error: "",
});
export function useM1Personal(api, onResourceChange = async () => {}) {
  const bookings = reactive({ ...makeList(), status: "" });
  const violations = reactive(makeList());
  const state = reactive({
    dialog: null,
    pending: false,
    success: "",
    refreshWarning: "",
  });
  let bookingVersion = 0,
    violationVersion = 0,
    dialogVersion = 0,
    disposed = false;
  onScopeDispose(() => {
    disposed = true;
    bookingVersion++;
    violationVersion++;
    dialogVersion++;
  });
  function validatePage(data) {
    if (
      !Array.isArray(data?.items) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0 ||
      !Number.isInteger(data.page) ||
      data.page < 1 ||
      !Number.isInteger(data.page_size) ||
      data.page_size < 1
    )
      throw new Error("分页数据格式异常，请刷新重试");
    return data;
  }
  async function refreshBookings() {
    const version = ++bookingVersion;
    bookings.loading = true;
    bookings.error = "";
    const params = { page: bookings.page, page_size: bookings.page_size };
    if (bookings.status) params.status = bookings.status;
    try {
      const data = validatePage(await api.bookings(params));
      if (disposed || version !== bookingVersion) return false;
      const last = Math.max(1, Math.ceil(data.total / data.page_size));
      if (params.page > last) {
        bookings.page = last;
        return refreshBookings();
      }
      Object.assign(bookings, {
        items: data.items,
        total: data.total,
        page: data.page,
        page_size: data.page_size,
        loaded: true,
      });
      return true;
    } catch (error) {
      if (!disposed && version === bookingVersion)
        bookings.error = error.message;
      return false;
    } finally {
      if (!disposed && version === bookingVersion) bookings.loading = false;
    }
  }
  function setStatus(status) {
    if (status && !Object.hasOwn(statusLabels, status)) return;
    bookings.status = status;
    bookings.page = 1;
    bookings.items = [];
    bookings.loaded = false;
    return refreshBookings();
  }
  function setPage(page) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > Math.max(1, Math.ceil(bookings.total / bookings.page_size))
    )
      return;
    bookings.page = page;
    bookings.items = [];
    bookings.loaded = false;
    return refreshBookings();
  }
  async function refreshViolations(page = violations.page) {
    if (!Number.isInteger(page) || page < 1) return false;
    const version = ++violationVersion;
    if (page !== violations.page) {
      violations.items = [];
      violations.loaded = false;
    }
    violations.page = page;
    violations.loading = true;
    violations.error = "";
    try {
      const data = validatePage(
        await api.violations({ page, page_size: violations.page_size }),
      );
      if (disposed || version !== violationVersion) return false;
      const last = Math.max(1, Math.ceil(data.total / data.page_size));
      if (page > last) return refreshViolations(last);
      Object.assign(violations, {
        items: data.items,
        total: data.total,
        page: data.page,
        page_size: data.page_size,
        loaded: true,
      });
      return true;
    } catch (error) {
      if (!disposed && version === violationVersion)
        violations.error = error.message;
      return false;
    } finally {
      if (!disposed && version === violationVersion) violations.loading = false;
    }
  }
  async function open(kind, id) {
    if (
      state.pending ||
      !["detail", "cancel", "checkin", "rebook"].includes(kind)
    )
      return;
    const version = ++dialogVersion,
      defaults = defaultFilters();
    state.success = "";
    state.refreshWarning = "";
    const item = {
      kind,
      id: String(id),
      record: null,
      loading: true,
      error: "",
      unavailable: false,
      code: "",
      start: defaults.start,
      end: defaults.end,
    };
    state.dialog = item;
    try {
      const record = await api.booking(item.id);
      if (disposed || version !== dialogVersion) return;
      if (!record || String(record.id) !== item.id || !record.status)
        throw new Error("预约详情格式异常，请刷新重试");
      state.dialog.record = record;
    } catch (error) {
      if (!disposed && version === dialogVersion) {
        state.dialog.error = error.message;
        state.dialog.unavailable = true;
      }
    } finally {
      if (!disposed && version === dialogVersion) state.dialog.loading = false;
    }
  }
  function close() {
    if (state.pending) return false;
    dialogVersion++;
    state.dialog = null;
    return true;
  }
  async function submit() {
    if (state.pending) return false;
    const dialog = state.dialog;
    if (
      !dialog ||
      dialog.loading ||
      !dialog.record ||
      dialog.unavailable ||
      dialog.kind === "detail"
    )
      return false;
    if (
      ["cancel", "checkin"].includes(dialog.kind) &&
      dialog.record.status !== "BOOKED"
    ) {
      dialog.error = "预约状态已变化，当前无法执行此操作，请刷新记录。";
      return false;
    }
    let body;
    dialog.error = "";
    if (dialog.kind === "checkin") {
      if (!dialog.code.trim()) {
        dialog.error = "请输入教室现场显示的签到码";
        return false;
      }
    }
    if (dialog.kind === "rebook") {
      try {
        const { params } = buildSearch({
          start: dialog.start,
          end: dialog.end,
        });
        body = {
          original_booking_id: dialog.id,
          start_time: params.start_time,
          end_time: params.end_time,
        };
      } catch (error) {
        dialog.error = error.message;
        return false;
      }
    }
    const version = dialogVersion;
    state.pending = true;
    state.success = "";
    state.refreshWarning = "";
    try {
      if (dialog.kind === "checkin")
        await api.checkin(dialog.id, dialog.code.trim());
      if (dialog.kind === "cancel") await api.cancel(dialog.id);
      if (dialog.kind === "rebook") await api.rebook(body);
      if (disposed) return true;
      state.success = {
        cancel: "预约已取消。",
        checkin: "签到成功，祝你学习顺利。",
        rebook: "再次预约成功，请按新时段到达并签到。",
      }[dialog.kind];
      dialogVersion++;
      state.dialog = null;
      // Never turn a successful write into a failed write because a read fails.
      const tasks = [refreshBookings()];
      if (dialog.kind !== "checkin")
        tasks.push(Promise.resolve().then(onResourceChange));
      const results = await Promise.allSettled(tasks);
      if (
        !disposed &&
        results.some((r) => r.status === "rejected" || r.value === false)
      )
        state.refreshWarning =
          "操作已成功，但部分列表未刷新。请刷新记录或重新查询座位，不要重复提交。";
      return true;
    } catch (error) {
      if (disposed || version !== dialogVersion) return false;
      dialog.error = error.status
        ? error.message
        : `未能确认操作结果：${error.message}。请先刷新记录，确认结果后再操作。`;
      if ([403, 404].includes(error.status)) dialog.unavailable = true;
      if (error.status === 409) {
        await refreshBookings();
        try {
          const record = await api.booking(dialog.id);
          if (
            !disposed &&
            version === dialogVersion &&
            record &&
            String(record.id) === dialog.id
          )
            dialog.record = record;
        } catch {
          /* Keep the original action error visible. */
        }
      }
      return false;
    } finally {
      state.pending = false;
    }
  }
  return {
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
  };
}
