import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: true,
  connectionLimit: 10,
});
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export const id = (v) => {
  if (typeof v !== "string" || !/^[1-9]\d{0,18}$/.test(v))
    throw fail(400, "ID 无效");
  return v;
};
export const text = (v, max = 1000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw fail(400, "文本字段无效");
  return v.trim();
};
export const role = (u, ...roles) => {
  if (!roles.some((r) => u.roles.includes(r))) throw fail(403, "没有操作权限");
};
export async function call(
  base,
  path,
  { token, body, method = "GET", d3 = false } = {},
) {
  let r, j;
  try {
    r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(d3 ? { "X-D3-Service-Token": token } : { Authorization: token }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    j = await r.json();
  } catch {
    throw fail(503, "依赖服务不可用");
  }
  if (!r.ok) throw fail(r.status, j.message || "依赖请求失败");
  return j.data;
}
export const d2 = (path, body, token) =>
  call(process.env.D2_BASE_URL, "/api/d2" + path, {
    token: token || `Bearer ${process.env.D2_SERVICE_TOKEN}`,
    body,
    method: body === undefined ? "GET" : "POST",
  });
export async function tx(fn) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export const rows = async (c, q, v = []) => (await c.query(q, v))[0];
export const one = async (c, q, v = []) => (await rows(c, q, v))[0];
export function page(q) {
  const p = Number(q.page || 1),
    n = Number(q.page_size || 20);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(n) || n < 1 || n > 100)
    throw fail(400, "分页无效");
  return { page: p, page_size: n, offset: (p - 1) * n };
}
export async function list(table, where, args, q) {
  const p = page(q);
  const [{ total }] = await rows(
    pool,
    `SELECT COUNT(*) total FROM ${table} WHERE ${where}`,
    args,
  );
  const items = await rows(
    pool,
    `SELECT * FROM ${table} WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, p.page_size, p.offset],
  );
  return { items, total, ...p };
}
export function appFor(module) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get(`/api/${module}/health`, async (req, res, next) => {
    try {
      await pool.query("SELECT 1");
      res.json({ code: "OK", data: { status: "UP" } });
    } catch (e) {
      next(e);
    }
  });
  app.use(async (req, res, next) => {
    try {
      req.user = await call(process.env.D1_BASE_URL, "/api/d1/users/me", {
        token: req.headers.authorization,
      });
      if (req.user.status !== "ACTIVE") throw fail(403, "账号未启用");
      next();
    } catch (e) {
      next(e);
    }
  });
  return app;
}
export function route(app, method, path, fn) {
  app[method](path, async (req, res, next) => {
    try {
      res.json({
        code: "OK",
        message: "success",
        data: await fn(req),
        request_id: randomUUID(),
      });
    } catch (e) {
      next(e);
    }
  });
}
export function finish(app, port) {
  app.use((req,res,next)=>next(fail(404,"接口不存在")));
  app.use((e, req, res, next) => {
    const status = e.status || 500;
    res
      .status(status)
      .json({
        code:
          {
            400: "VALIDATION_ERROR",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            409: "INVALID_STATE",
            503: "DEPENDENCY_UNAVAILABLE",
          }[status] || "INTERNAL_ERROR",
        message: status === 500 ? "服务内部错误" : e.message,
        data: null,
        request_id: randomUUID(),
      });
  });
  return app.listen(port, process.env.HOST || "127.0.0.1");
}
export async function event(c, module, user, action, target) {
  await c.query("INSERT INTO event_outbox (payload) VALUES (?)", [
    JSON.stringify({
      module,
      user_id: user || null,
      action,
      target_type: module === "M1" ? "SEAT_BOOKING" : "REPAIR_TICKET",
      target_id: String(target),
      source_event_id: randomUUID(),
      result: "SUCCESS",
    }),
  ]);
}
export async function deliver() {
  for (const r of await rows(
    pool,
    "SELECT * FROM event_outbox WHERE sent=0 ORDER BY id LIMIT 30",
  )) {
    try {
      await call(process.env.D3_BASE_URL, "/api/d3/internal/logs", {
        method: "POST",
        d3: true,
        token: process.env.D3_SERVICE_TOKEN,
        body: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      });
      await pool.query("UPDATE event_outbox SET sent=1 WHERE id=?", [r.id]);
    } catch {
      break;
    }
  }
}
