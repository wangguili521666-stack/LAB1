import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = {
  getItem: () => "fixture-token",
  setItem() {},
  removeItem() {},
};
globalThis.window = { addEventListener() {} };
const { m1Api } = await import("../src/api/m1.js");
test("admin adapters use verified user profile, encoded key and string setting body", async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: "OK", data: {} }),
    };
  };
  await m1Api.profile();
  await m1Api.adminBookings({ page: 2, page_size: 20 });
  await m1Api.statistics({ start_time: "a", end_time: "b" });
  await m1Api.settings();
  await m1Api.updateSetting("server/key", "6");
  assert.equal(calls[0].path, "/api/d1/users/me");
  assert.equal(calls[1].path, "/api/m1/admin/bookings?page=2&page_size=20");
  assert.equal(
    calls[2].path,
    "/api/m1/admin/statistics?start_time=a&end_time=b",
  );
  assert.equal(calls[3].path, "/api/m1/settings");
  assert.equal(calls[4].path, "/api/m1/settings/server%2Fkey");
  assert.equal(calls[4].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[4].options.body), { setting_value: "6" });
});
test("personal adapters preserve pagination, IDs, CODE payload and new rebook interval", async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: "OK", data: {} }),
    };
  };
  await m1Api.bookings({ page: 2, page_size: 20, status: "COMPLETED" });
  await m1Api.booking("9007199254740993");
  await m1Api.checkin("9007199254740993", "AB12");
  await m1Api.rebook({
    original_booking_id: "9007199254740993",
    start_time: "new-start",
    end_time: "new-end",
  });
  await m1Api.violations({ page: 2, page_size: 20 });
  assert.equal(
    calls[0].path,
    "/api/m1/bookings/me?page=2&page_size=20&status=COMPLETED",
  );
  assert.equal(calls[1].path, "/api/m1/bookings/9007199254740993");
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    checkin_method: "CODE",
    code: "AB12",
  });
  assert.equal(calls[3].path, "/api/m1/bookings/rebook");
  assert.equal(
    JSON.parse(calls[3].options.body).original_booking_id,
    "9007199254740993",
  );
  assert.equal(calls[4].path, "/api/m1/violations/me?page=2&page_size=20");
});
test("M1 adapter uses protected request envelope, query encoding and exact body", async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: "OK", data: { items: [] } }),
    };
  };
  await m1Api.search({
    building: "教学楼 A",
    start_time: "2026-11-01T09:00:00+08:00",
  });
  await m1Api.book({
    seat_id: "9007199254740993",
    start_time: "start",
    end_time: "end",
  });
  await m1Api.bookings();
  await m1Api.cancel("501");
  assert.equal(
    new URL(calls[0].path, "http://local").searchParams.get("start_time"),
    "2026-11-01T09:00:00+08:00",
  );
  for (const { options } of calls)
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    seat_id: "9007199254740993",
    start_time: "start",
    end_time: "end",
  });
  assert.equal(calls[2].path, "/api/m1/bookings/me?page=1&page_size=20");
  assert.equal(calls[3].path, "/api/m1/bookings/501/cancel");
});
