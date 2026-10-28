// Explicit local-only fixture server. Never imported by the application or build.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
let mode = "success",
  bookings = [],
  serial = 500,
  mutations = 0;
const seats = [
  {
    seat_id: "301",
    seat_number: "A01",
    classroom_id: "201",
    building: "教学楼 A",
    room_number: "301",
    socket_type: "FIXED",
    available: true,
    college_id: "1",
  },
  {
    seat_id: "302",
    seat_number: "A02",
    classroom_id: "201",
    building: "教学楼 A",
    room_number: "301",
    socket_type: "RAIL",
    available: true,
    college_id: "1",
  },
  {
    seat_id: "303",
    seat_number: "B01",
    classroom_id: "202",
    building: "图书馆",
    room_number: "自习室 2",
    socket_type: "NONE",
    available: true,
    college_id: "2",
  },
];
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  plugins: [
    {
      name: "m1-explicit-test-fixtures",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://127.0.0.1");
          if (
            !url.pathname.startsWith("/api/m1/") &&
            url.pathname !== "/__m1_preview"
          )
            return next();
          const reply = (status, data, message = "success") => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                code:
                  status < 400
                    ? "OK"
                    : status === 409
                      ? "RESOURCE_CONFLICT"
                      : "DEPENDENCY_UNAVAILABLE",
                message,
                data,
              }),
            );
          };
          if (url.pathname === "/__m1_preview") {
            if (req.method === "POST") {
              mode = url.searchParams.get("mode") || "success";
              bookings = [];
              serial = 500;
              mutations = 0;
              if (
                [
                  "history",
                  "forbidden",
                  "missing",
                  "expired-code",
                  "personal-refresh-error",
                ].includes(mode)
              ) {
                const states = [
                  "BOOKED",
                  "CHECKED_IN",
                  "CANCELLED",
                  "NO_SHOW",
                  "COMPLETED",
                ];
                bookings = Array.from({ length: 26 }, (_, i) => ({
                  id: String(501 + i),
                  seat_id: String(301 + (i % 3)),
                  reservation_id: String(901 + i),
                  status: states[i % 5],
                  start_time: "2026-11-01T09:00:00+08:00",
                  end_time: "2026-11-01T11:00:00+08:00",
                  created_at: "2026-10-28T08:00:00+08:00",
                  cancelled_at:
                    states[i % 5] === "CANCELLED"
                      ? "2026-10-28T09:00:00+08:00"
                      : null,
                }));
                serial = 600;
              }
            }
            return reply(200, { mode, bookings, mutations });
          }
          try {
            if (mode === "slow")
              await new Promise((resolve) => setTimeout(resolve, 1000));
            const path = url.pathname;
            if (
              mode === "error" ||
              (mode === "personal-refresh-error" &&
                mutations > 0 &&
                req.method === "GET") ||
              (mode === "refresh-error" &&
                bookings.length &&
                req.method === "GET")
            )
              return reply(503, null, "测试场景：服务暂不可用，请稍后重试");
            if (path === "/api/m1/seats/available") {
              const filtered =
                mode === "empty"
                  ? []
                  : seats.filter((seat) =>
                      [
                        "building",
                        "classroom_id",
                        "college_id",
                        "socket_type",
                      ].every(
                        (key) =>
                          !url.searchParams.get(key) ||
                          seat[key] === url.searchParams.get(key),
                      ),
                    );
              return reply(
                200,
                filtered.filter(
                  (seat) =>
                    !bookings.some(
                      (b) =>
                        b.seat_id === seat.seat_id &&
                        b.status === "BOOKED" &&
                        b.start_time < url.searchParams.get("end_time") &&
                        url.searchParams.get("start_time") < b.end_time,
                    ),
                ),
              );
            }
            const paginate = (items) => {
              const page = Math.max(
                1,
                Number(url.searchParams.get("page")) || 1,
              );
              const size = Math.max(
                1,
                Number(url.searchParams.get("page_size")) || 20,
              );
              return {
                items: items.slice((page - 1) * size, page * size),
                page,
                page_size: size,
                total: items.length,
              };
            };
            if (path === "/api/m1/bookings/me")
              return reply(
                200,
                paginate(
                  bookings.filter(
                    (b) =>
                      !url.searchParams.get("status") ||
                      b.status === url.searchParams.get("status"),
                  ),
                ),
              );
            if (path === "/api/m1/violations/me")
              return reply(
                200,
                paginate(
                  [
                    "history",
                    "forbidden",
                    "missing",
                    "expired-code",
                    "personal-refresh-error",
                  ].includes(mode)
                    ? Array.from({ length: 23 }, (_, i) => ({
                        id: String(801 + i),
                        booking_id: "504",
                        violation_type: "NO_SHOW",
                        occurred_at: "2026-11-01T09:15:00+08:00",
                      }))
                    : [],
                ),
              );
            const detail = /^\/api\/m1\/bookings\/(\d+)$/.exec(path);
            if (detail && req.method === "GET") {
              const booking = bookings.find((b) => b.id === detail[1]);
              return booking && mode !== "missing"
                ? reply(200, booking)
                : reply(404, null, "预约记录不存在");
            }
            const action =
              /^\/api\/m1\/bookings\/(\d+)\/(checkin|cancel)$/.exec(path);
            if (action && req.method === "POST") {
              const booking = bookings.find((b) => b.id === action[1]);
              if (mode === "forbidden")
                return reply(403, null, "无权操作该预约");
              if (!booking) return reply(404, null, "预约记录不存在");
              if (booking.status !== "BOOKED")
                return reply(409, null, "预约状态已变化");
              if (action[2] === "checkin") {
                let text = "";
                for await (const chunk of req) text += chunk;
                const body = JSON.parse(text);
                if (mode === "expired-code" || body.code !== "482916")
                  return reply(422, null, "签到码错误或已过期");
                booking.status = "CHECKED_IN";
                mutations++;
                return reply(200, {
                  id: String(1000 + mutations),
                  booking_id: booking.id,
                  checkin_method: "CODE",
                  checkin_time: new Date().toISOString(),
                });
              }
              booking.status = "CANCELLED";
              booking.cancelled_at = new Date().toISOString();
              mutations++;
              return reply(200, booking);
            }
            if (path === "/api/m1/bookings/rebook" && req.method === "POST") {
              let text = "";
              for await (const chunk of req) text += chunk;
              const body = JSON.parse(text),
                original = bookings.find(
                  (b) => b.id === body.original_booking_id,
                );
              if (!original) return reply(404, null, "原预约不存在");
              if (
                bookings.some(
                  (b) =>
                    b.seat_id === original.seat_id &&
                    ["BOOKED", "CHECKED_IN"].includes(b.status) &&
                    b.start_time < body.end_time &&
                    body.start_time < b.end_time,
                )
              )
                return reply(409, null, "所选时段已被占用，请另选时段");
              const booking = {
                id: String(++serial),
                seat_id: original.seat_id,
                start_time: body.start_time,
                end_time: body.end_time,
                status: "BOOKED",
                created_at: new Date().toISOString(),
                cancelled_at: null,
              };
              bookings.unshift(booking);
              mutations++;
              return reply(201, booking);
            }
            if (path === "/api/m1/bookings" && req.method === "POST") {
              let text = "";
              for await (const chunk of req) text += chunk;
              const body = JSON.parse(text);
              if (mode === "conflict")
                return reply(409, null, "测试场景：该座位已被占用");
              const booking = {
                ...body,
                id: String(++serial),
                status: "BOOKED",
                created_at: new Date().toISOString(),
              };
              bookings.unshift(booking);
              return reply(201, booking);
            }
            return reply(404, null, "测试场景未定义该接口");
          } catch {
            return reply(400, null, "测试请求格式错误");
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "M1 模拟接口预览（不会写入真实预约）：http://127.0.0.1:5174/tests/m1-preview.html",
);
