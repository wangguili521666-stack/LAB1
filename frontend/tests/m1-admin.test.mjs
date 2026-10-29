import { test } from "node:test";
import assert from "node:assert/strict";
import { effectScope, ref } from "vue";
import { useM1Admin } from "../src/composables/useM1Admin.js";
import {
  buildAdminQuery,
  defaultAdminFilters,
  readStatistics,
} from "../src/utils/m1Admin.js";
const page = (items = [], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  page_size: 20,
});
const setting = () => ({
  setting_key: "server/key",
  setting_value: "4",
  updated_at: "2026-10-28T00:00:00+08:00",
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function setup(t, roles = ["SYSTEM_ADMIN"], overrides = {}, session) {
  const scope = effectScope();
  const api = {
    profile: async () => ({ roles }),
    adminBookings: async () => page(),
    statistics: async () => ({
      total_bookings: 0,
      completed_bookings: 0,
      no_show_bookings: 0,
      cancelled_bookings: 0,
    }),
    settings: async () => [setting()],
    updateSetting: async () => ({}),
    ...overrides,
  };
  const m = scope.run(() => useM1Admin(api, session));
  t.after(() => scope.stop());
  await m.loadAccess();
  return m;
}
test("admin dates are campus midnight, unbounded by student four-hour duration", () => {
  const f = {
    start: "2026-10-28",
    end: "2026-10-31",
    classroom_id: "9007199254740993",
    status: "BOOKED",
  };
  assert.deepEqual(buildAdminQuery(f), {
    start_time: "2026-10-28T00:00:00+08:00",
    end_time: "2026-10-31T00:00:00+08:00",
    classroom_id: "9007199254740993",
    status: "BOOKED",
  });
  assert.ok(!("status" in buildAdminQuery(f, true)));
  assert.deepEqual(defaultAdminFilters(new Date("2026-10-28T17:00:00Z")), {
    start: "2026-10-29",
    end: "2026-10-30",
    classroom_id: "",
    status: "",
  });
});
test("admin date pair, calendar, ordering and classroom identifier validated", () => {
  assert.deepEqual(
    buildAdminQuery({ start: "", end: "", classroom_id: "" }),
    {},
  );
  for (const f of [
    { start: "2026-10-28", end: "" },
    { start: "2026-02-30", end: "2026-03-02" },
    { start: "2026-10-28", end: "2026-10-28" },
    { start: "", end: "", classroom_id: "x" },
  ])
    assert.throws(() => buildAdminQuery(f));
  assert.throws(() => buildAdminQuery({ start: "", end: "" }, true));
});
test("missing statistics remain null, actual zero remains zero", () => {
  assert.deepEqual(readStatistics({ total_bookings: 0 }), {
    total_bookings: 0,
    completed_bookings: null,
    no_show_bookings: null,
    cancelled_bookings: null,
  });
  assert.throws(() => readStatistics({ total_bookings: "0" }));
  assert.throws(() => readStatistics({ total_bookings: -1 }));
  assert.throws(() => readStatistics(null));
});
test("student and unrelated roles cannot send any admin request", async (t) => {
  let calls = 0;
  const m = await setup(t, ["STUDENT", "PROPERTY_ADMIN"], {
    adminBookings: async () => {
      calls++;
    },
    statistics: async () => {
      calls++;
    },
    settings: async () => {
      calls++;
    },
  });
  assert.equal(m.canRead.value, false);
  await m.loadRecords();
  await m.loadStatistics();
  await m.loadSettings();
  assert.equal(calls, 0);
});
test("operational and classroom managers read but cannot edit settings", async (t) => {
  for (const role of ["OPERATION_ADMIN", "CLASSROOM_ADMIN"]) {
    let writes = 0;
    const m = await setup(t, [role], {
      updateSetting: async () => {
        writes++;
      },
    });
    assert.equal(m.canRead.value, true);
    assert.equal(m.canWrite.value, false);
    await m.loadSettings();
    m.settings.edit = { key: "x", original: "1", value: "2" };
    await m.saveSetting();
    assert.equal(writes, 0);
  }
});
test("profile failure fails closed and remains retryable", async (t) => {
  let fail = true;
  const m = await setup(t, [], {
    profile: async () => {
      if (fail) throw new Error("身份服务不可用");
      return { roles: ["SYSTEM_ADMIN"] };
    },
  });
  assert.equal(m.canRead.value, false);
  assert.match(m.access.error, /不可用/);
  fail = false;
  await m.loadAccess();
  assert.equal(m.canWrite.value, true);
});
test("list query encodes page, status and classroom as exact contract values", async (t) => {
  let query;
  const m = await setup(t, undefined, {
    adminBookings: async (params) => {
      query = params;
      return page([], 40, 2);
    },
  });
  Object.assign(m.filters, {
    start: "",
    end: "",
    classroom_id: "201",
    status: "COMPLETED",
  });
  await m.loadRecords(2);
  assert.deepEqual(query, {
    classroom_id: "201",
    status: "COMPLETED",
    page: 2,
    page_size: 20,
  });
  assert.equal(m.records.page, 2);
});
test("changing filters discards in-flight old management results", async (t) => {
  const d = deferred();
  const m = await setup(t, undefined, { adminBookings: () => d.promise });
  const pending = m.loadRecords();
  m.filters.classroom_id = "202";
  d.resolve(page([{ id: "1" }]));
  await pending;
  assert.equal(m.records.loaded, false);
  assert.deepEqual(m.records.items, []);
  assert.equal(m.records.loading, false);
});
test("newer statistics request wins over older one", async (t) => {
  const a = deferred(),
    b = deferred();
  let calls = 0;
  const m = await setup(t, undefined, {
    statistics: () => (++calls === 1 ? a.promise : b.promise),
  });
  const first = m.loadStatistics();
  m.statFilters.classroom_id = "202";
  const second = m.loadStatistics();
  b.resolve({ total_bookings: 2 });
  await second;
  a.resolve({ total_bookings: 9 });
  await first;
  assert.equal(m.stats.data.total_bookings, 2);
});
test("403 clears previously loaded data and removes access", async (t) => {
  let fail = false;
  const m = await setup(t, undefined, {
    adminBookings: async () => {
      if (fail) throw Object.assign(new Error("无权"), { status: 403 });
      return page([{ id: "1" }]);
    },
  });
  await m.loadRecords();
  await m.loadSettings();
  assert.equal(m.records.items.length, 1);
  fail = true;
  await m.loadRecords();
  assert.equal(m.canRead.value, false);
  assert.deepEqual(m.records.items, []);
  assert.deepEqual(m.settings.items, []);
  assert.match(m.access.error, /拒绝/);
});
test("session replacement prevents late admin response from exposing old data", async (t) => {
  const token = ref("old"),
    d = deferred();
  let first = true;
  const m = await setup(
    t,
    undefined,
    {
      profile: async () => ({ roles: first ? ["SYSTEM_ADMIN"] : ["STUDENT"] }),
      statistics: () => d.promise,
    },
    () => token.value,
  );
  const pending = m.loadStatistics();
  first = false;
  token.value = "new";
  await Promise.resolve();
  d.resolve({ total_bookings: 123 });
  await pending;
  assert.equal(m.canRead.value, false);
  assert.equal(m.stats.data, null);
});
test("only server-returned keys can be edited and no-op is rejected", async (t) => {
  let writes = 0;
  const m = await setup(t, undefined, {
    updateSetting: async () => {
      writes++;
    },
  });
  await m.loadSettings();
  m.editSetting("invented");
  assert.equal(m.settings.edit, null);
  m.editSetting("server/key");
  await m.saveSetting();
  assert.equal(writes, 0);
  assert.match(m.settings.edit.error, /未改变/);
});
test("configuration save uses original key and exact string, then reloads", async (t) => {
  const item = setting(),
    calls = [];
  const m = await setup(t, undefined, {
    settings: async () => [{ ...item }],
    updateSetting: async (key, value) => {
      calls.push({ key, value });
      item.setting_value = value;
    },
  });
  await m.loadSettings();
  m.editSetting(item.setting_key);
  m.settings.edit.value = " 6 ";
  assert.equal(await m.saveSetting(), true);
  assert.deepEqual(calls, [{ key: "server/key", value: " 6 " }]);
  assert.equal(m.settings.items[0].setting_value, " 6 ");
  assert.equal(m.settings.edit, null);
  assert.match(m.settings.success, /已保存/);
});
test("duplicate saves send one write and keep dialog locked while pending", async (t) => {
  const d = deferred();
  let calls = 0;
  const m = await setup(t, undefined, {
    updateSetting: () => {
      calls++;
      return d.promise;
    },
  });
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "6";
  const first = m.saveSetting(),
    second = m.saveSetting();
  assert.equal(calls, 1);
  assert.equal(m.closeEdit(), false);
  d.resolve({});
  await first;
  assert.equal(await second, false);
});
test("422 leaves original data and editable draft intact", async (t) => {
  const m = await setup(t, undefined, {
    updateSetting: async () => {
      throw Object.assign(new Error("范围不合法"), { status: 422 });
    },
  });
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "invalid";
  await m.saveSetting();
  assert.equal(m.settings.items[0].setting_value, "4");
  assert.equal(m.settings.edit.value, "invalid");
  assert.match(m.settings.edit.error, /不合法/);
  assert.equal(m.settings.success, "");
});
test("successful write plus failed reload is not reported as write failure", async (t) => {
  let saved = false;
  const m = await setup(t, undefined, {
    settings: async () => {
      if (saved) throw new Error("读取失败");
      return [setting()];
    },
    updateSetting: async () => {
      saved = true;
    },
  });
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "6";
  assert.equal(await m.saveSetting(), true);
  assert.match(m.settings.success, /已保存/);
  assert.match(m.settings.error, /不要重复保存/);
  assert.equal(m.settings.edit, null);
});
test("403 write revokes permission and clears stale configuration", async (t) => {
  const m = await setup(t, undefined, {
    updateSetting: async () => {
      throw Object.assign(new Error("拒绝"), { status: 403 });
    },
  });
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "6";
  await m.saveSetting();
  assert.equal(m.canWrite.value, false);
  assert.equal(m.settings.edit, null);
  assert.deepEqual(m.settings.items, []);
});
test("malformed or duplicated setting keys prevent editing", async (t) => {
  const m = await setup(t, undefined, {
    settings: async () => [setting(), setting()],
  });
  await m.loadSettings();
  assert.match(m.settings.error, /格式异常/);
  m.editSetting("server/key");
  assert.equal(m.settings.edit, null);
});
test("network write uncertainty instructs refresh without success claim", async (t) => {
  const m = await setup(t, undefined, {
    updateSetting: async () => {
      throw new Error("请求超时");
    },
  });
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "6";
  await m.saveSetting();
  assert.match(m.settings.edit.error, /先刷新配置/);
  assert.equal(m.settings.success, "");
});
test("late save completion cannot reveal old configuration to a replacement session", async (t) => {
  const token = ref("old"),
    d = deferred();
  let admin = true;
  const m = await setup(
    t,
    undefined,
    {
      profile: async () => ({ roles: admin ? ["SYSTEM_ADMIN"] : ["STUDENT"] }),
      updateSetting: () => d.promise,
    },
    () => token.value,
  );
  await m.loadSettings();
  m.editSetting("server/key");
  m.settings.edit.value = "6";
  const save = m.saveSetting();
  admin = false;
  token.value = "new";
  await Promise.resolve();
  d.resolve({});
  await save;
  assert.equal(m.canWrite.value, false);
  assert.equal(m.settings.success, "");
  assert.deepEqual(m.settings.items, []);
  assert.equal(m.settings.edit, null);
});
