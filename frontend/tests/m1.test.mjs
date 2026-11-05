import { test } from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import {
  buildSearch,
  defaultFilters,
  parseCampusTime,
} from "../src/utils/m1.js";
import { useM1Booking } from "../src/composables/useM1Booking.js";

const filters = () => ({
  start: "2026-11-01T09:00",
  end: "2026-11-01T11:00",
  building: "",
  classroom_id: "",
  college_id: "",
  socket_type: "",
});
const seat = {
  seat_id: "9007199254740993",
  seat_number: "A01",
  available: true,
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup(t, overrides = {}) {
  const api = {
    settings: async () => [{ setting_key: "max_booking_hours", setting_value: "4" }],
    search: async () => [seat],
    book: async () => ({ id: "501" }),
    bookings: async () => ({ items: [] }),
    cancel: async () => ({}),
    ...overrides,
  };
  const scope = effectScope(),
    model = scope.run(() => useM1Booking(api));
  Object.assign(model.filters, filters());
  t.after(() => scope.stop());
  return model;
}
test("campus time is UTC+08 and IDs remain strings; empty filters omitted", () => {
  const f = {
    ...filters(),
    classroom_id: "9007199254740993",
    socket_type: "FIXED",
    building: " 教学楼A ",
  };
  const query = buildSearch(f);
  assert.equal(query.params.start_time, "2026-11-01T09:00:00+08:00");
  assert.equal(
    parseCampusTime(f.start).timestamp,
    Date.parse("2026-11-01T01:00:00Z"),
  );
  assert.equal(query.params.classroom_id, "9007199254740993");
  assert.equal(query.params.building, "教学楼A");
  assert.ok(!("college_id" in query.params));
});
test("default date follows current campus day and rolls across midnight", () => {
  const f = defaultFilters(new Date("2026-10-28T15:32:00Z"));
  assert.equal(f.start, "2026-10-29T00:00");
  assert.equal(f.end, "2026-10-29T01:00");
});
test("invalid calendar, missing values, reversed/equal times and non-hour times rejected", () => {
  for (const start of [
    "",
    "2026-02-30T09:00",
    "2026-11-01T24:00",
    "2026-11-01T09:30",
  ])
    assert.throws(() => buildSearch({ ...filters(), start }));
  for (const end of ["2026-11-01T09:00", "2026-11-01T08:00"])
    assert.throws(() => buildSearch({ ...filters(), end }), /晚于/);
});
test("duration boundary uses supplied limit and supports valid midnight crossing", () => {
  assert.doesNotThrow(() =>
    buildSearch({ ...filters(), end: "2026-11-01T13:00" }),
  );
  assert.throws(
    () => buildSearch({ ...filters(), end: "2026-11-01T14:00" }),
    /4 小时/,
  );
  assert.doesNotThrow(() =>
    buildSearch({ ...filters(), end: "2026-11-01T14:00" }, 5),
  );
  assert.throws(() => buildSearch(filters(), 0), /配置无效/);
  assert.doesNotThrow(() =>
    buildSearch({
      ...filters(),
      start: "2026-11-01T23:00",
      end: "2026-11-02T01:00",
    }),
  );
});
test("filter validation rejects invalid ID and socket enum", () => {
  assert.throws(() => buildSearch({ ...filters(), college_id: "x" }), /编号/);
  assert.throws(
    () => buildSearch({ ...filters(), socket_type: "fake" }),
    /插座/,
  );
});
test("invalid input never sends a search request", async (t) => {
  let calls = 0;
  const m = setup(t, {
    search: async () => {
      calls++;
      return [];
    },
  });
  m.filters.end = m.filters.start;
  assert.equal(await m.search(), false);
  assert.equal(calls, 0);
  assert.match(m.state.searchError, /晚于/);
});
test("newer search wins over a late older response", async (t) => {
  const a = deferred(),
    b = deferred();
  let calls = 0;
  const m = setup(t, { search: () => (++calls === 1 ? a.promise : b.promise) });
  const first = m.search();
  await new Promise(resolve => setImmediate(resolve));
  m.filters.building = "B";
  const second = m.search();
  b.resolve([{ ...seat, seat_number: "B01" }]);
  await second;
  a.resolve([{ ...seat, seat_number: "A01" }]);
  await first;
  assert.equal(m.state.seats[0].seat_number, "B01");
  assert.equal(m.state.snapshot.params.building, "B");
});
test("editing filters while searching discards stale response and re-enables search", async (t) => {
  const d = deferred(),
    m = setup(t, { search: () => d.promise });
  const pending = m.search();
  m.filters.building = "changed";
  d.resolve([seat]);
  await pending;
  assert.equal(m.state.searched, false);
  assert.equal(m.state.snapshot, null);
  assert.equal(m.state.searching, false);
});
test("editing filters invalidates result and closes confirmation without posting", async (t) => {
  let posts = 0;
  const m = setup(t, {
    book: async () => {
      posts++;
    },
  });
  await m.search();
  m.select(m.state.seats[0]);
  assert.ok(m.state.selected);
  m.filters.socket_type = "FIXED";
  assert.equal(m.stale.value, true);
  assert.equal(m.state.selected, null);
  m.select(seat);
  await m.confirmBooking();
  assert.equal(posts, 0);
});
test("unavailable seat cannot be selected", async (t) => {
  const m = setup(t);
  await m.search();
  m.select({ ...seat, available: false });
  assert.equal(m.state.selected, null);
});
test("duplicate confirmation posts exactly once using selected query snapshot", async (t) => {
  const d = deferred();
  const bodies = [];
  let searches = 0,
    records = 0;
  const m = setup(t, {
    search: async () => {
      searches++;
      return [seat];
    },
    book: (body) => {
      bodies.push(body);
      return d.promise;
    },
    bookings: async () => {
      records++;
      return { items: [] };
    },
  });
  await m.search();
  m.select(seat);
  const first = m.confirmBooking();
  const second = m.confirmBooking();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bodies.length, 1);
  assert.equal(await second, false);
  assert.deepEqual(bodies[0], {
    seat_id: seat.seat_id,
    start_time: "2026-11-01T09:00:00+08:00",
    end_time: "2026-11-01T11:00:00+08:00",
  });
  d.resolve({ id: "501" });
  assert.equal(await first, true);
  assert.equal(searches, 2);
  assert.equal(records, 1);
  assert.equal(m.state.bookingPending, false);
});
test("409 clears confirmation, refreshes availability and never reports success", async (t) => {
  let calls = 0;
  const m = setup(t, {
    search: async () => (++calls === 1 ? [seat] : []),
    book: async () => {
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
  });
  await m.search();
  m.select(seat);
  assert.equal(await m.confirmBooking(), false);
  assert.equal(m.state.selected, null);
  assert.equal(m.state.seats.length, 0);
  assert.equal(m.state.success, "");
  assert.match(m.state.bookingError, /不可预约/);
});
test("successful write remains successful when both refreshes fail", async (t) => {
  let calls = 0;
  const m = setup(t, {
    search: async () => {
      if (++calls > 1) throw new Error("查询服务暂不可用");
      return [seat];
    },
    bookings: async () => {
      throw new Error("记录服务暂不可用");
    },
  });
  await m.search();
  m.select(seat);
  assert.equal(await m.confirmBooking(), true);
  assert.match(m.state.success, /预约成功/);
  assert.match(m.state.searchError, /查询服务/);
  assert.match(m.state.recordsError, /记录服务/);
  assert.equal(m.state.selected, null);
});
test("write errors recover pending state and allow explicit retry", async (t) => {
  let calls = 0;
  const m = setup(t, {
    book: async () => {
      if (++calls === 1) throw new Error("服务不可用");
      return {};
    },
  });
  await m.search();
  m.select(seat);
  assert.equal(await m.confirmBooking(), false);
  assert.equal(m.state.bookingPending, false);
  assert.match(m.state.bookingError, /服务不可用/);
  assert.equal(await m.confirmBooking(), true);
  assert.equal(calls, 2);
});
test("malformed response is an error rather than empty success", async (t) => {
  const m = setup(t, { search: async () => null, bookings: async () => ({}) });
  await m.search();
  await m.loadRecords();
  assert.match(m.state.searchError, /格式/);
  assert.match(m.state.recordsError, /格式/);
  assert.equal(m.state.searched, false);
});
test("403, 422 and 503 keep server explanations without success or stuck pending", async (t) => {
  for (const status of [403, 422, 503]) {
    const m = setup(t, {
      book: async () => {
        throw Object.assign(new Error(`服务端说明 ${status}`), { status });
      },
    });
    await m.search();
    m.select(seat);
    await m.confirmBooking();
    assert.equal(m.state.bookingError, `服务端说明 ${status}`);
    assert.equal(m.state.success, "");
    assert.equal(m.state.bookingPending, false);
  }
});
test("uncertain write outcome tells user to check records before retrying", async (t) => {
  const m = setup(t, {
    book: async () => {
      throw new Error("请求超时");
    },
  });
  await m.search();
  m.select(seat);
  await m.confirmBooking();
  assert.match(m.state.bookingError, /先刷新“我的预约”/);
  assert.equal(m.state.success, "");
});
test("cancel preserves existing action, refreshes and prevents duplicate requests", async (t) => {
  const d = deferred();
  let calls = 0;
  const m = setup(t, {
    cancel: () => {
      calls++;
      return d.promise;
    },
  });
  const first = m.cancel("501");
  await m.cancel("501");
  assert.equal(calls, 1);
  d.resolve({});
  await first;
  assert.match(m.state.success, /已取消/);
  assert.equal(m.state.cancelPending, "");
});

test('server limit drives search and revalidates confirmation after configuration changes', async t => {
  let limit=6, writes=0;
  const m=setup(t,{settings:async()=>[{setting_key:'max_booking_hours',setting_value:String(limit)}],book:async()=>{writes++;return {id:'1'}}});
  m.filters.end='2026-11-01T14:00';
  assert.equal(await m.search(),true);
  assert.equal(m.state.maxHours,6);
  m.select(seat);limit=2;
  assert.equal(await m.confirmBooking(),false);
  assert.equal(writes,0);
  assert.match(m.state.bookingError,/2 小时/);
  assert.equal(await m.search(),false);
  m.filters.end='2026-11-01T11:00';
  assert.equal(await m.search(),true);
  m.select(seat);assert.equal(await m.confirmBooking(),true);assert.equal(writes,1);
});
test('missing, invalid or unavailable setting blocks search rather than falling back to four hours', async t => {
  for(const settings of [async()=>[],async()=>[{setting_key:'max_booking_hours',setting_value:'0'}],async()=>{throw Error('配置服务不可用')}]){
    let calls=0;const m=setup(t,{settings,search:async()=>{calls++;return [seat]}});
    assert.equal(await m.search(),false);assert.equal(calls,0);assert.equal(m.state.searching,false);assert.equal(m.state.maxHours,null);
  }
});
test('changing filters during configuration fetch does not send a stale query', async t => {
  const d=deferred();let calls=0;const m=setup(t,{settings:()=>d.promise,search:async()=>{calls++;return [seat]}});
  const pending=m.search();m.filters.building='changed';d.resolve([{setting_key:'max_booking_hours',setting_value:'6'}]);
  assert.equal(await pending,false);assert.equal(calls,0);assert.equal(m.state.searching,false);
});
