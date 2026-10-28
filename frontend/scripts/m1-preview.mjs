// Explicit local-only fixture server. Never imported by the application or build.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
let mode = "success",
  bookings = [],
  serial = 500;
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
            }
            return reply(200, { mode, bookings });
          }
          try {
            if (mode === "slow")
              await new Promise((resolve) => setTimeout(resolve, 1000));
            const path = url.pathname;
            if (
              mode === "error" ||
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
            if (path === "/api/m1/bookings/me")
              return reply(200, {
                items: bookings,
                page: 1,
                page_size: 20,
                total: bookings.length,
              });
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
            const cancel = /^\/api\/m1\/bookings\/(\d+)\/cancel$/.exec(path);
            if (cancel && req.method === "POST") {
              const booking = bookings.find((b) => b.id === cancel[1]);
              if (booking) {
                booking.status = "CANCELLED";
                return reply(200, booking);
              }
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
