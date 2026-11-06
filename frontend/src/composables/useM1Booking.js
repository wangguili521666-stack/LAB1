import { computed, reactive, watch, onScopeDispose } from "vue";
import { buildSearch, defaultFilters, filterKey, loadBookingLimit } from "../utils/m1.js";
export function useM1Booking(api, options = {}) {
  const filters = reactive(defaultFilters());
  const state = reactive({
    maxHours: null,
    seats: [],
    snapshot: null,
    searched: false,
    searching: false,
    searchError: "",
    selected: null,
    bookingPending: false,
    bookingError: "",
    success: "",
    records: [],
    recordsLoaded: false,
    recordsPending: false,
    recordsError: "",
    cancelPending: "",
    cancelError: "",
  });
  let searchVersion = 0,
    recordsVersion = 0,
    disposed = false;
  const stale = computed(
    () => !!state.snapshot && state.snapshot.key !== filterKey(filters),
  );
  watch(
    () => filterKey(filters),
    () => {
      searchVersion++;
      state.searching = false;
      state.searchError = "";
      if (!state.bookingPending) state.selected = null;
    },
    { flush: "sync" },
  );
  onScopeDispose(() => {
    disposed = true;
    searchVersion++;
    recordsVersion++;
  });
  async function search() {
    const version = ++searchVersion;
    state.searchError = "";
    state.snapshot = null;
    state.seats = [];
    state.searched = false;
    if (!state.bookingPending) state.selected = null;
    let query;
    state.searching = true;
    try {
      const requested = { ...filters };
      const maxHours = await loadBookingLimit(api);
      if (disposed || version !== searchVersion) return false;
      state.maxHours = maxHours;
      query = buildSearch(requested, maxHours);
    } catch (error) {
      if (!disposed && version === searchVersion) { state.searching = false; state.maxHours = null; state.searchError = error.message; }
      return false;
    }
    state.searching = true;
    try {
      const seats = await api.search(query.params);
      if (disposed || version !== searchVersion) return false;
      if (!Array.isArray(seats))
        throw new Error("座位数据格式异常，请稍后重试");
      state.seats = seats;
      state.snapshot = query;
      state.searched = true;
      return true;
    } catch (error) {
      if (!disposed && version === searchVersion)
        state.searchError = error.message;
      return false;
    } finally {
      if (!disposed && version === searchVersion) state.searching = false;
    }
  }
  function select(seat) {
    if (
      state.bookingPending ||
      state.searching ||
      stale.value ||
      !state.snapshot ||
      seat.available !== true ||
      !seat.seat_id
    )
      return;
    state.bookingError = "";
    state.success = "";
    state.selected = {
      seat: { ...seat },
      query: { key: state.snapshot.key, params: { ...state.snapshot.params } },
    };
  }
  async function loadRecords() {
    const version = ++recordsVersion;
    state.recordsPending = true;
    state.recordsError = "";
    try {
      const data = await api.bookings();
      if (disposed || version !== recordsVersion) return false;
      if (!Array.isArray(data?.items))
        throw new Error("预约记录格式异常，请稍后重试");
      state.records = data.items;
      state.recordsLoaded = true;
      return true;
    } catch (error) {
      if (!disposed && version === recordsVersion)
        state.recordsError = error.message;
      return false;
    } finally {
      if (!disposed && version === recordsVersion) state.recordsPending = false;
    }
  }
  async function confirmBooking() {
    if (state.bookingPending) return false;
    const selection = state.selected;
    if (!selection) return false;
    if (
      selection.query.key !== filterKey(filters) ||
      stale.value ||
      !state.snapshot ||
      state.searching
    ) {
      state.bookingError = "查询条件已变化，请重新查询后预约";
      state.selected = null;
      return false;
    }
    state.bookingPending = true;
    state.bookingError = "";
    state.success = "";
    try {
      state.maxHours = await loadBookingLimit(api);
      if (disposed) return false;
      buildSearch({ start: selection.query.params.start_time.slice(0,16), end: selection.query.params.end_time.slice(0,16) }, state.maxHours);
      await api.book({
        seat_id: String(selection.seat.seat_id),
        start_time: selection.query.params.start_time,
        end_time: selection.query.params.end_time,
      });
      if (disposed) return true;
      state.success = "预约成功。请按时到达并签到。";
      state.selected = null;
      await Promise.all([
        search(),
        options.refreshRecords ? options.refreshRecords() : loadRecords(),
      ]);
      return true;
    } catch (error) {
      if (disposed) return false;
      state.bookingError =
        error.status === 409
          ? "该座位在所选时段已不可预约，请重新选择。"
          : error.status
            ? error.message
            : `未能确认预约结果：${error.message}。请先刷新“我的预约”，确认未成功后再重试。`;
      if (error.status === 409) {
        state.selected = null;
        await search();
      }
      return false;
    } finally {
      state.bookingPending = false;
    }
  }
  // Preserve existing cancellation; full lifecycle and permissions are phase three.
  async function cancel(id) {
    if (state.cancelPending) return;
    state.cancelPending = String(id);
    state.cancelError = "";
    state.success = "";
    try {
      await api.cancel(id);
      if (!disposed) {
        state.success = "预约已取消。";
        await Promise.all([
          loadRecords(),
          state.snapshot ? search() : Promise.resolve(),
        ]);
      }
    } catch (error) {
      if (!disposed) state.cancelError = error.message;
    } finally {
      state.cancelPending = "";
    }
  }
  return {
    filters,
    state,
    stale,
    search,
    select,
    loadRecords,
    confirmBooking,
    cancel,
  };
}
