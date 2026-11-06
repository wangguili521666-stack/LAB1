import { test } from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import { useM1Personal } from "../src/composables/useM1Personal.js";
import { formatRecordTime } from "../src/utils/m1.js";
test("history timestamps include year and campus timezone", () => {
  assert.match(formatRecordTime("2025-12-31T17:00:00Z"), /2026/);
  assert.match(formatRecordTime("2025-12-31T17:00:00Z"), /01:00/);
  assert.equal(formatRecordTime(null), "时间未知");
});
const record = {
  id: "9007199254740993",
  seat_id: "301",
  status: "BOOKED",
  start_time: "2026-10-01T09:00:00+08:00",
  end_time: "2026-10-01T11:00:00+08:00",
};
const page = (items = [], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  page_size: 20,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(t, overrides = {}, onChange) {
  const scope = effectScope();
  const api = {
    settings: async () => [{ setting_key: "max_booking_hours", setting_value: "4" }],
    bookings: async () => page(),
    booking: async (id) => ({ ...record, id }),
    violations: async () => page(),
    checkin: async () => ({}),
    cancel: async () => ({}),
    rebook: async () => ({}),
    ...overrides,
  };
  const m = scope.run(() => useM1Personal(api, onChange));
  t.after(() => scope.stop());
  return m;
}
test("personal status resets page and sends only confirmed pagination fields", async (t) => {
  const calls = [];
  const m = setup(t, {
    bookings: async (params) => {
      calls.push(params);
      return page();
    },
  });
  m.bookings.page = 3;
  await m.setStatus("COMPLETED");
  assert.deepEqual(calls[0], { page: 1, page_size: 20, status: "COMPLETED" });
  await m.setStatus("");
  assert.deepEqual(calls[1], { page: 1, page_size: 20 });
});
test("late list response cannot replace newest filter result", async (t) => {
  const a = deferred(),
    b = deferred();
  let calls = 0;
  const m = setup(t, {
    bookings: () => (++calls === 1 ? a.promise : b.promise),
  });
  const first = m.refreshBookings();
  const second = m.setStatus("NO_SHOW");
  b.resolve(page([{ ...record, status: "NO_SHOW" }]));
  await second;
  a.resolve(page([record]));
  await first;
  assert.equal(m.bookings.items[0].status, "NO_SHOW");
});
test("removing final item on last page returns to existing page", async (t) => {
  const calls = [];
  const m = setup(t, {
    bookings: async (params) => {
      calls.push(params.page);
      return page([record], 20, params.page);
    },
  });
  m.bookings.page = 2;
  await m.refreshBookings();
  assert.deepEqual(calls, [2, 1]);
  assert.equal(m.bookings.page, 1);
  assert.equal(m.bookings.loading, false);
});
test("details preserve large ID and ignore response after dismissal", async (t) => {
  const d = deferred();
  const m = setup(t, { booking: () => d.promise });
  const result = m.open("detail", record.id);
  m.close();
  d.resolve(record);
  await result;
  assert.equal(m.state.dialog, null);
});
test("new detail wins over old request", async (t) => {
  const a = deferred(),
    b = deferred();
  const m = setup(t, { booking: (id) => (id === "1" ? a.promise : b.promise) });
  const first = m.open("detail", "1");
  const second = m.open("detail", "2");
  b.resolve({ ...record, id: "2" });
  await second;
  a.resolve({ ...record, id: "1" });
  await first;
  assert.equal(m.state.dialog.record.id, "2");
});
test("404 details cannot submit and retain readable explanation", async (t) => {
  let writes = 0;
  const m = setup(t, {
    booking: async () => {
      throw Object.assign(new Error("预约不存在"), { status: 404 });
    },
    cancel: async () => {
      writes++;
    },
  });
  await m.open("cancel", record.id);
  await m.submit();
  assert.match(m.state.dialog.error, /不存在/);
  assert.equal(writes, 0);
});
test("empty checkin is rejected, code is trimmed without invented length restriction", async (t) => {
  const calls = [];
  const m = setup(t, { checkin: async (id, code) => calls.push({ id, code }) });
  await m.open("checkin", record.id);
  m.state.dialog.code = " ";
  assert.equal(await m.submit(), false);
  assert.equal(calls.length, 0);
  m.state.dialog.code = " AB12 ";
  assert.equal(await m.submit(), true);
  assert.deepEqual(calls, [{ id: record.id, code: "AB12" }]);
  assert.match(m.state.success, /签到成功/);
});
test("422 checkin error permits correcting the code without optimistic state change", async (t) => {
  const m = setup(t, {
    checkin: async () => {
      throw Object.assign(new Error("签到码已过期"), { status: 422 });
    },
  });
  await m.open("checkin", record.id);
  m.state.dialog.code = "bad";
  await m.submit();
  assert.equal(m.state.dialog.record.status, "BOOKED");
  assert.equal(m.state.dialog.unavailable, false);
  assert.match(m.state.dialog.error, /已过期/);
  assert.equal(m.state.success, "");
  assert.equal(m.state.pending, false);
});
test("cancel requires explicit submit and duplicate submit sends once", async (t) => {
  const d = deferred();
  let writes = 0;
  const m = setup(t, {
    cancel: () => {
      writes++;
      return d.promise;
    },
  });
  await m.open("cancel", record.id);
  assert.equal(writes, 0);
  const first = m.submit();
  assert.equal(m.close(), false);
  const second = m.submit();
  assert.equal(writes, 1);
  d.resolve({});
  await first;
  assert.equal(await second, false);
  assert.match(m.state.success, /已取消/);
  assert.equal(m.state.dialog, null);
});
test("403 prevents repeated cancel and does not fake success", async (t) => {
  let calls = 0;
  const m = setup(t, {
    cancel: async () => {
      calls++;
      throw Object.assign(new Error("无权取消"), { status: 403 });
    },
  });
  await m.open("cancel", record.id);
  await m.submit();
  await m.submit();
  assert.equal(calls, 1);
  assert.equal(m.state.dialog.unavailable, true);
  assert.equal(m.state.success, "");
});
test("409 action reloads actual state and blocks obsolete action", async (t) => {
  let details = 0;
  const m = setup(t, {
    booking: async () => ({
      ...record,
      status: ++details === 1 ? "BOOKED" : "CHECKED_IN",
    }),
    cancel: async () => {
      throw Object.assign(new Error("状态已变化"), { status: 409 });
    },
  });
  await m.open("cancel", record.id);
  await m.submit();
  assert.equal(m.state.dialog.record.status, "CHECKED_IN");
  assert.equal(await m.submit(), false);
  assert.equal(m.state.success, "");
});
test("rebook uses new times and original ID, never copies old booking date", async (t) => {
  let body;
  const m = setup(t, {
    rebook: async (value) => {
      body = value;
    },
  });
  await m.open("rebook", record.id);
  assert.notEqual(m.state.dialog.start, "2026-10-01T09:00");
  m.state.dialog.start = "2026-11-02T10:00";
  m.state.dialog.end = "2026-11-02T12:00";
  await m.submit();
  assert.deepEqual(body, {
    original_booking_id: record.id,
    start_time: "2026-11-02T10:00:00+08:00",
    end_time: "2026-11-02T12:00:00+08:00",
  });
});
test("invalid rebook interval never sends write; conflict preserves user input", async (t) => {
  let writes = 0;
  const m = setup(t, {
    rebook: async () => {
      writes++;
      throw Object.assign(new Error("该时段被占用"), { status: 409 });
    },
  });
  await m.open("rebook", record.id);
  m.state.dialog.start = "2026-11-02T09:00";
  m.state.dialog.end = "2026-11-02T14:00";
  await m.submit();
  assert.equal(writes, 0);
  m.state.dialog.end = "2026-11-02T11:00";
  await m.submit();
  assert.equal(writes, 1);
  assert.equal(m.state.dialog.end, "2026-11-02T11:00");
  assert.match(m.state.dialog.error, /占用/);
});
test("successful cancel survives both list and availability refresh failure", async (t) => {
  const m = setup(
    t,
    {
      bookings: async () => {
        throw new Error("记录读取失败");
      },
    },
    async () => {
      throw new Error("资源读取失败");
    },
  );
  await m.open("cancel", record.id);
  assert.equal(await m.submit(), true);
  assert.match(m.state.success, /已取消/);
  assert.match(m.state.refreshWarning, /不要重复提交/);
  assert.equal(m.state.dialog, null);
});
test("uncertain write response recommends inspecting current records", async (t) => {
  const m = setup(t, {
    cancel: async () => {
      throw new Error("请求超时");
    },
  });
  await m.open("cancel", record.id);
  await m.submit();
  assert.match(m.state.dialog.error, /先刷新记录/);
  assert.equal(m.state.success, "");
});
test("violation pagination and failure are independent of booking list", async (t) => {
  const calls = [];
  const m = setup(t, {
    violations: async (params) => {
      calls.push(params);
      return page(
        [{ id: "801", booking_id: record.id, violation_type: "NO_SHOW" }],
        23,
        params.page,
      );
    },
  });
  await m.refreshBookings();
  await m.refreshViolations(2);
  assert.equal(m.violations.page, 2);
  assert.equal(m.violations.total, 23);
  assert.deepEqual(calls[0], { page: 2, page_size: 20 });
  assert.equal(m.bookings.error, "");
});
test("malformed pagination is not presented as empty success", async (t) => {
  const m = setup(t, {
    bookings: async () => ({ items: [], total: -1, page: 1, page_size: 20 }),
  });
  await m.refreshBookings();
  assert.match(m.bookings.error, /格式异常/);
  assert.equal(m.bookings.loaded, false);
});

test('history rebooking uses refreshed limit and prevents duplicate writes while settings load', async t=>{
  let limit=6,writes=0;
  const m=setup(t,{settings:async()=>[{setting_key:'max_booking_hours',setting_value:String(limit)}],rebook:async()=>{writes++}});
  await m.open('rebook',record.id);m.state.dialog.start='2026-11-01T09:00';m.state.dialog.end='2026-11-01T14:00';
  const first=m.submit();assert.equal(await m.submit(),false);assert.equal(await first,true);assert.equal(writes,1);
  limit=2;await m.open('rebook',record.id);m.state.dialog.start='2026-11-01T09:00';m.state.dialog.end='2026-11-01T12:00';
  assert.equal(await m.submit(),false);assert.equal(writes,1);assert.match(m.state.dialog.error,/2 小时/);assert.equal(m.state.pending,false);
});
