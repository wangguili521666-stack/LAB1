import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = {
  getItem: () => "fixture-token",
  setItem() {},
  removeItem() {},
};
globalThis.window = { addEventListener() {} };
const { m1Api } = await import("../src/api/m1.js");
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
