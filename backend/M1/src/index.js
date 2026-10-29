import {dailyCode,displayCode} from './checkin-code.js';
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  pool,
  fail,
  id,
  role,
  call,
  d2,
  tx,
  rows,
  one,
  list,
  appFor,
  route,
  finish,
  event,
  deliver,
} from "./common.js";
const app = appFor("m1"),
  base = "/api/m1";
if (!process.env.CHECKIN_SECRET || process.env.CHECKIN_SECRET.length < 32)
  throw Error("CHECKIN_SECRET 至少 32 字符");
const iso = (d) => new Date(d).toISOString();
const code=room=>dailyCode(process.env.CHECKIN_SECRET,room);
async function interval(body) {
  const a = new Date(body.start_time),
    b = new Date(body.end_time);
  const s = await one(
    pool,
    "SELECT setting_value FROM booking_settings WHERE setting_key='max_booking_hours'",
  );
  if (
    !Number.isFinite(+a) ||
    !Number.isFinite(+b) ||
    +a <= Date.now() ||
    +b <= +a ||
    +a % 3600000 ||
    +b % 3600000 ||
    +b - a > Number(s.setting_value) * 3600000
  )
    throw fail(400, "预约须为未来整点时段，且不超过配置时长");
  return [a, b];
}
async function owned(c, bid, u, lock = false) {
  const b = await one(
    c,
    "SELECT * FROM seat_bookings WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [id(bid)],
  );
  if (!b) throw fail(404, "预约不存在");
  if (b.user_id !== u.id) throw fail(403, "只能操作本人预约");
  return b;
}
async function reconcile(c, b) {
  if (b.status === "CREATING") {
    let r;
    try {
      r = await d2("/reservations", {
        resource_type: "SEAT",
        resource_id: b.seat_id,
        source_module: "M1",
        source_id: b.id,
        start_time: iso(b.start_time),
        end_time: iso(b.end_time),
        hold_expires_at: iso(b.hold_expires_at),
      });
      await c.query("UPDATE seat_bookings SET reservation_id=? WHERE id=?", [
        r.id,
        b.id,
      ]);
      r = await d2("/reservations/" + r.id + "/confirm", {});
      await c.query("UPDATE seat_bookings SET status='BOOKED' WHERE id=?", [
        b.id,
      ]);
      await event(c, "M1", b.user_id, "BOOKING_CREATE", b.id);
    } catch (e) {
      if ([400, 403, 404, 409, 422].includes(e.status)) {
        await c.query(
          "UPDATE seat_bookings SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(3) WHERE id=?",
          [b.id],
        );
        return;
      }
      throw e;
    }
  }
  if (["CANCELLING", "EXPIRING"].includes(b.status)) {
    if (b.reservation_id)
      await d2("/reservations/" + b.reservation_id + "/release", {
        reason: b.status,
      });
    const s = b.status === "EXPIRING" ? "NO_SHOW" : "CANCELLED";
    await c.query(
      "UPDATE seat_bookings SET status=?,cancelled_at=UTC_TIMESTAMP(3) WHERE id=?",
      [s, b.id],
    );
    if (s === "NO_SHOW") {
      const notice = {
        source_event_id: `m1:${b.id}:NO_SHOW`,
        notification_type: "NO_SHOW",
        biz_type: "SEAT_BOOKING",
        biz_id: b.id,
        recipient_user_ids: [b.user_id],
        title: "未签到违约",
        content: "预约已取消，座位已释放，并记录一次违约。",
        occurred_at: new Date().toISOString(),
      };
      await c.query(
        "INSERT IGNORE INTO notification_outbox(booking_id,kind,payload) VALUES (?, ?, ?)",
        [b.id, "NO_SHOW", JSON.stringify(notice)],
      );
    }
    if (s === "NO_SHOW")
      await c.query(
        "INSERT IGNORE INTO booking_violations(user_id,booking_id,violation_type,occurred_at) VALUES (?,?,'NO_SHOW',UTC_TIMESTAMP(3))",
        [b.user_id, b.id],
      );
    await event(c, "M1", b.user_id, s, b.id);
  }
}
async function book(req, body) {
  const [a, b] = await interval(body);
  id(body.seat_id);
  const seat = await d2(
    "/seats/" + body.seat_id,
    undefined,
    req.headers.authorization,
  );
  const room = await d2(
    "/classrooms/" + seat.classroom_id,
    undefined,
    req.headers.authorization,
  );
  if (
    room.college_id &&
    room.college_id !== req.user.college_id &&
    !req.user.roles.includes("SYSTEM_ADMIN")
  )
    throw fail(403, "仅本院系可预约");
  const [r] = await pool.query(
    "INSERT INTO seat_bookings(user_id,seat_id,classroom_id,start_time,end_time,status,hold_expires_at) VALUES (?,?,?,?,?,'CREATING',?)",
    [
      req.user.id,
      body.seat_id,
      seat.classroom_id,
      a,
      b,
      new Date(Date.now() + 300000),
    ],
  );
  const bid = String(r.insertId);
  await tx(async (c) => reconcile(c, await owned(c, bid, req.user, true)));
  const result = await owned(pool, bid, req.user);
  if (result.status !== "BOOKED") throw fail(409, "资源不可预约，请刷新后重试");
  return result;
}
route(app, "get", base + "/seats/available", async (req) => {
  await interval(req.query);
  const filters = {};
  for (const k of ["classroom_id", "building", "college_id", "socket_type"])
    if (req.query[k]) filters[k] = req.query[k];
  const result = await d2(
    "/availability/search",
    {
      resource_type: "SEAT",
      start_time: req.query.start_time,
      end_time: req.query.end_time,
      filters,
    },
    req.headers.authorization,
  );
  const out = [];
  for (const r of result.filter((r) => r.available)) {
    const s = await d2(
        "/seats/" + r.resource_id,
        undefined,
        req.headers.authorization,
      ),
      c = await d2(
        "/classrooms/" + r.classroom_id,
        undefined,
        req.headers.authorization,
      );
    if (
      c.college_id &&
      c.college_id !== req.user.college_id &&
      !req.user.roles.includes("SYSTEM_ADMIN")
    )
      continue;
    out.push({
      seat_id: s.id,
      seat_number: s.seat_number,
      socket_type: s.socket_type,
      classroom_id: c.id,
      building: c.building,
      room_number: c.room_number,
      available: true,
    });
  }
  return out;
});
route(app, "post", base + "/bookings", (req) => book(req, req.body));
route(app, "post", base + "/bookings/rebook", async (req) => {
  const old = await owned(pool, req.body.original_booking_id, req.user);
  return book(req, { ...req.body, seat_id: old.seat_id });
});
route(app, "get", base + "/bookings/me", (req) =>
  list(
    "seat_bookings",
    "user_id=?" + (req.query.status ? " AND status=?" : ""),
    [req.user.id, ...(req.query.status ? [req.query.status] : [])],
    req.query,
  ),
);
route(app, "get", base + "/bookings/:id", (req) =>
  owned(pool, req.params.id, req.user),
);
route(app, "post", base + "/bookings/:id/cancel", async (req) => {
  await tx(async (c) => {
    const b = await owned(c, req.params.id, req.user, true);
    if (b.status === "CANCELLED") return;
    if (b.status !== "BOOKED") throw fail(409, "当前状态不能取消");
    await c.query("UPDATE seat_bookings SET status='CANCELLING' WHERE id=?", [
      b.id,
    ]);
  });
  await tx(async (c) =>
    reconcile(c, await owned(c, req.params.id, req.user, true)),
  );
  return owned(pool, req.params.id, req.user);
});
route(app, "post", base + "/bookings/:id/checkin", (req) =>
  tx(async (c) => {
    const b = await owned(c, req.params.id, req.user, true);
    if (
      b.status !== "BOOKED" ||
      Date.now() < +b.start_time ||
      Date.now() >= +b.start_time + 900000
    )
      throw fail(409, "不在签到时间内");
    if (
      req.body.checkin_method !== "CODE" ||
      typeof req.body.code !== "string" ||
      !/^\d{6}$/.test(req.body.code) ||
      !timingSafeEqual(
        Buffer.from(code(b.classroom_id)),
        Buffer.from(req.body.code),
      )
    )
      throw fail(400, "签到码无效");
    await c.query(
      "INSERT INTO seat_checkins(booking_id,checkin_method,checkin_time) VALUES (?,'CODE',UTC_TIMESTAMP(3))",
      [b.id],
    );
    await c.query("UPDATE seat_bookings SET status='CHECKED_IN' WHERE id=?", [
      b.id,
    ]);
    await event(c, "M1", req.user.id, "CHECKIN", b.id);
    return one(c, "SELECT * FROM seat_checkins WHERE booking_id=?", [b.id]);
  }),
);
route(app, "get", base + "/violations/me", (req) =>
  list("booking_violations", "user_id=?", [req.user.id], req.query),
);
route(app, "get", base + "/settings", () =>
  rows(pool, "SELECT * FROM booking_settings"),
);
route(app, "put", base + "/settings/:key", async (req) => {
  if(!req.user.roles.includes("SYSTEM_ADMIN")&&!req.user.permissions?.includes("booking:configure"))throw fail(403,"没有配置权限");
  const n = Number(req.body.setting_value);
  if (
    req.params.key !== "max_booking_hours" ||
    !Number.isInteger(n) ||
    n < 1 ||
    n > 24
  )
    throw fail(400, "配置无效");
  await pool.query(
    "UPDATE booking_settings SET setting_value=?,updated_at=UTC_TIMESTAMP(3) WHERE setting_key=?",
    [String(n), req.params.key],
  );
  return one(pool, "SELECT * FROM booking_settings WHERE setting_key=?", [
    req.params.key,
  ]);
});
route(app, "get", base + "/admin/checkin-code/:classroom", async (req) => {
  if(!req.user.roles.includes("SYSTEM_ADMIN")&&!req.user.permissions?.includes("checkin:display"))throw fail(403,"没有展示权限");
  const room = await d2(
    "/classrooms/" + id(req.params.classroom),
    undefined,
    req.headers.authorization,
  );
  if (
    !req.user.roles.includes("SYSTEM_ADMIN") &&
    (!req.user.college_id || room.college_id !== req.user.college_id)
  )
    throw fail(403, "仅可管理本学院教室");
  return {
    classroom_id: req.params.classroom,
    ...displayCode(process.env.CHECKIN_SECRET,req.params.classroom),
    building: room.building, room_number: room.room_number,
  };
});
async function adminFilter(req) {
  if(!req.user.roles.includes("SYSTEM_ADMIN")&&!req.user.permissions?.some(p=>["booking:read","booking:read_all"].includes(p)))throw fail(403,"没有查询权限");
  let w = "1=1",
    a = [];
  if (
    !req.user.roles.includes("SYSTEM_ADMIN")&&!req.user.permissions?.includes("booking:read_all")
  ) {
    if (!req.user.college_id) throw fail(403, "未分配学院");
    const rooms = await d2(
      "/classrooms?college_id=" + req.user.college_id + "&page_size=100",
      undefined,
      req.headers.authorization,
    );
    const ids = rooms.items.map((r) => r.id);
    if (rooms.total > 100)
      throw fail(503, "学院教室数量超过查询上限，请联系管理员");
    w = ids.length
      ? "classroom_id IN (" + ids.map(() => "?").join(",") + ")"
      : "1=0";
    a = ids;
  }
  for (const k of ["classroom_id", "status"])
    if (req.query[k]) {
      w += ` AND ${k}=?`;
      a.push(req.query[k]);
    }
  for (const [k, op] of [
    ["start_time", ">="],
    ["end_time", "<="],
  ])
    if (req.query[k]) {
      const d = new Date(req.query[k]);
      if (!Number.isFinite(+d)) throw fail(400, "时间无效");
      w += ` AND start_time${op}?`;
      a.push(d);
    }
  return [w, a];
}
route(app, "get", base + "/admin/bookings", async (req) => {
  const [w, a] = await adminFilter(req);
  return list("seat_bookings", w, a, req.query);
});
route(app, "get", base + "/admin/statistics", async (req) => {
  const [w, a] = await adminFilter(req);
  const result = await one(
    pool,
    `SELECT COUNT(*) total_bookings,COALESCE(SUM(status='COMPLETED'),0) completed_bookings,COALESCE(SUM(status='NO_SHOW'),0) no_show_bookings,COALESCE(SUM(status='CANCELLED'),0) cancelled_bookings FROM seat_bookings WHERE ${w}`,
    a,
  );
  return Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, Number(v)]),
  );
});
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const b of await rows(
      pool,
      "SELECT * FROM seat_bookings WHERE status IN ('CREATING','CANCELLING','EXPIRING','BOOKED','CHECKED_IN')",
    )) {
      try {
        await tx(async (c) => {
          const r = await one(
            c,
            "SELECT * FROM seat_bookings WHERE id=? FOR UPDATE",
            [b.id],
          );
          if (r.status === "BOOKED" && Date.now() >= +r.start_time + 900000) {
            await c.query(
              "UPDATE seat_bookings SET status='EXPIRING' WHERE id=?",
              [r.id],
            );
            return;
          }
          await reconcile(c, r);
          if (r.status === "CHECKED_IN" && Date.now() >= +r.end_time)
            await c.query(
              "UPDATE seat_bookings SET status='COMPLETED' WHERE id=?",
              [r.id],
            );
          if (r.status === "BOOKED") {
            const delta = Date.now() - r.start_time;
            const kind =
              delta >= 600000
                ? "LATE_REMINDER"
                : delta >= -900000
                  ? "BOOKING_REMINDER"
                  : null;
            if (kind) {
              const payload = {
                source_event_id: `m1:${r.id}:${kind}`,
                notification_type: kind,
                biz_type: "SEAT_BOOKING",
                biz_id: r.id,
                recipient_user_ids: [r.user_id],
                title: "预约签到提醒",
                content: "请按时到达教室并签到",
                occurred_at: new Date().toISOString(),
              };
              await c.query(
                "INSERT IGNORE INTO notification_outbox(booking_id,kind,payload) VALUES (?,?,?)",
                [r.id, kind, JSON.stringify(payload)],
              );
            }
          }
        });
      } catch {
        console.error("M1_RECONCILE_RETRY");
      }
    }
    await deliver();
    for (const r of await rows(
      pool,
      "SELECT * FROM notification_outbox WHERE sent=0 LIMIT 30",
    )) {
      await call(process.env.D3_BASE_URL, "/api/d3/internal/notifications", {
        method: "POST",
        d3: true,
        token: process.env.D3_SERVICE_TOKEN,
        body: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      });
      await pool.query("UPDATE notification_outbox SET sent=1 WHERE id=?", [
        r.id,
      ]);
    }
  } catch {
    console.error("M1_WORKER_RETRY");
  } finally {
    busy = false;
  }
}
finish(app, Number(process.env.PORT || 3001));
setInterval(tick, 5000).unref();
tick();
