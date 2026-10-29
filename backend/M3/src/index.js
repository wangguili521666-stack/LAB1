import { randomUUID } from "node:crypto";
import {
  pool,
  fail,
  id,
  text,
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
const app = appFor("m3"),
  base = "/api/m3";
const manager = (u) =>
  (u.roles.includes("SYSTEM_ADMIN")||u.permissions?.includes("repair:manage"));
async function ticket(c, bid, u, lock = false) {
  const t = await one(
    c,
    "SELECT * FROM repair_tickets WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [id(bid)],
  );
  if (!t) throw fail(404, "工单不存在");
  if (!manager(u) && t.reporter_id !== u.id && t.assigned_to !== u.id)
    throw fail(403, "无权访问工单");
  return t;
}
async function sync(t) {
  if (t.classroom_id && t.sync_pending) {
    await d2("/internal/maintenance/sync", {
      ticket_id: t.id,
      classroom_id: t.classroom_id,
      active: Boolean(t.maintenance_active),
      revision: t.revision,
    });
    await pool.query(
      "UPDATE repair_tickets SET sync_pending=0 WHERE id=? AND revision=?",
      [t.id, t.revision],
    );
  }
}
route(app, "get", base + "/repair-types", () =>
  rows(pool, "SELECT * FROM repair_types"),
);
route(app, "post", base + "/tickets", async (req) => {
  const body = req.body,
    type = await one(pool, "SELECT * FROM repair_types WHERE id=?", [
      id(body.repair_type_id),
    ]);
  if (!type) throw fail(400, "故障类型不存在");
  if (body.classroom_id)
    await d2(
      "/classrooms/" + id(body.classroom_id),
      undefined,
      req.headers.authorization,
    );
  return tx(async (c) => {
    const [r] = await c.query(
      "INSERT INTO repair_tickets(ticket_number,reporter_id,repair_type_id,classroom_id,location_description,description,priority,status,deadline_at) VALUES (?,?,?,?,?,?,?,'PENDING_ASSIGNMENT',?)",
      [
        "REP" + randomUUID(),
        req.user.id,
        type.id,
        body.classroom_id || null,
        text(body.location_description, 255),
        text(body.description, 10000),
        type.default_priority,
        new Date(Date.now() + type.sla_hours * 3600000),
      ],
    );
    await event(c, "M3", req.user.id, "REPORT", String(r.insertId));
    return ticket(c, String(r.insertId), req.user);
  });
});
route(app, "get", base + "/tickets/me", (req) =>
  list(
    "repair_tickets",
    "reporter_id=?" + (req.query.status ? " AND status=?" : ""),
    [req.user.id, ...(req.query.status ? [req.query.status] : [])],
    req.query,
  ),
);
route(app, "get", base + "/tickets", (req) => {
  if(!manager(req.user)&&!req.user.permissions?.includes("repair:work"))throw fail(403,"无工单查询权限");
  let w = manager(req.user) ? "1=1" : "assigned_to=?",
    a = manager(req.user) ? [] : [req.user.id];
  for (const k of ["status", "priority", "assigned_to"])
    if (req.query[k]) {
      w += ` AND ${k}=?`;
      a.push(req.query[k]);
    }
  return list("repair_tickets", w, a, req.query);
});
route(app, "get", base + "/tickets/:id", (req) =>
  ticket(pool, req.params.id, req.user),
);
route(app, "get", base + "/tickets/:id/progress", async (req) => {
  await ticket(pool, req.params.id, req.user);
  return rows(
    pool,
    "SELECT * FROM repair_progress WHERE ticket_id=? ORDER BY id",
    [req.params.id],
  );
});
for (const action of [
  "assign",
  "start",
  "progress",
  "finish",
  "accept",
  "cancel",
])
  route(app, "post", base + `/tickets/:id/${action}`, async (req) => {
    const result = await tx(async (c) => {
      const t = await ticket(c, req.params.id, req.user, true),
        body = req.body || {};
      let status = t.status,
        active = t.maintenance_active,
        desc = body.description || body.comment || body.reason || "",
        kind = action.toUpperCase();
      if (t.sync_pending) throw fail(409, "资源状态正在同步，请稍后重试");
      if (action === "assign") {
        if(!manager(req.user))throw fail(403,"无派单权限");
        if (!["PENDING_ASSIGNMENT", "ASSIGNED"].includes(t.status))
          throw fail(409, "当前状态不能派单");
        id(body.worker_id);
        const worker = await call(
          process.env.D1_BASE_URL,
          "/api/d1/admin/users/" + body.worker_id,
          { token: req.headers.authorization },
        );
        if (
          worker.status !== "ACTIVE" ||
          !worker.permissions?.includes("repair:work")
        )
          throw fail(400, "必须指派有效维修工");
        status = "ASSIGNED";
        await c.query(
          "UPDATE repair_tickets SET assigned_to=?,assigned_at=UTC_TIMESTAMP(3) WHERE id=?",
          [body.worker_id, t.id],
        );
      } else if (["start", "progress", "finish"].includes(action)) {
        if(!req.user.permissions?.includes("repair:work"))throw fail(403,"无维修权限");
        if (t.assigned_to !== req.user.id)
          throw fail(403, "只能处理指派给自己的工单");
        if (action === "start") {
          if (t.status !== "ASSIGNED") throw fail(409, "状态无效");
          status = "IN_PROGRESS";
          active = 1;
        } else {
          if (t.status !== "IN_PROGRESS") throw fail(409, "状态无效");
          if (action === "finish") {
            status = "PENDING_ACCEPTANCE";
            await c.query(
              "UPDATE repair_tickets SET completed_at=UTC_TIMESTAMP(3) WHERE id=?",
              [t.id],
            );
          } else desc = text(body.description);
        }
      } else {
        if (t.reporter_id !== req.user.id) throw fail(403, "仅报修人可操作");
        if (action === "cancel") {
          if (t.status !== "PENDING_ASSIGNMENT")
            throw fail(409, "仅待派单工单可取消");
          status = "CANCELLED";
        } else {
          if (
            t.status !== "PENDING_ACCEPTANCE" ||
            typeof body.accepted !== "boolean"
          )
            throw fail(409, "验收状态无效");
          status = body.accepted ? "COMPLETED" : "IN_PROGRESS";
          if (body.accepted) {
            active = 0;
            await c.query(
              "UPDATE repair_tickets SET accepted_at=UTC_TIMESTAMP(3) WHERE id=?",
              [t.id],
            );
          } else {
            desc = text(body.comment);
            kind = "REWORK";
          }
        }
      }
      const changed = Number(active) !== Number(t.maintenance_active);
      await c.query(
        "UPDATE repair_tickets SET status=?,maintenance_active=?,revision=revision+?,sync_pending=? WHERE id=?",
        [
          status,
          active,
          changed ? 1 : 0,
          changed && t.classroom_id ? 1 : 0,
          t.id,
        ],
      );
      await c.query(
        "INSERT INTO repair_progress(ticket_id,operator_id,action_type,old_status,new_status,description) VALUES (?,?,?,?,?,?)",
        [t.id, req.user.id, kind, t.status, status, desc],
      );
      await event(c, "M3", req.user.id, kind, t.id);
      return ticket(c, t.id, req.user);
    });
    await sync(result);
    return ticket(pool, result.id, req.user);
  });
route(app, "post", base + "/tickets/:id/review", (req) =>
  tx(async (c) => {
    const t = await ticket(c, req.params.id, req.user, true);
    if (t.reporter_id !== req.user.id) throw fail(403, "仅报修人可评价");
    if (t.status !== "COMPLETED") throw fail(409, "完成后才能评价");
    if (
      !Number.isInteger(req.body.rating) ||
      req.body.rating < 1 ||
      req.body.rating > 5
    )
      throw fail(400, "评分须为 1–5");
    if (await one(c, "SELECT id FROM repair_reviews WHERE ticket_id=?", [t.id]))
      throw fail(409, "不可重复评价");
    await c.query(
      "INSERT INTO repair_reviews(ticket_id,reviewer_id,rating,comment) VALUES (?,?,?,?)",
      [t.id, req.user.id, req.body.rating, req.body.comment || ""],
    );
    await event(c, "M3", req.user.id, "REVIEW", t.id);
    return one(c, "SELECT * FROM repair_reviews WHERE ticket_id=?", [t.id]);
  }),
);
route(app, "get", base + "/tickets/:id/review", async (req) => {
  await ticket(pool, req.params.id, req.user);
  return (
    (await one(pool, "SELECT * FROM repair_reviews WHERE ticket_id=?", [
      req.params.id,
    ])) || null
  );
});
route(app, "get", base + "/admin/overdue", (req) => {
  if(!manager(req.user))throw fail(403,"无管理权限");
  return list(
    "repair_tickets",
    "status NOT IN ('COMPLETED','CANCELLED') AND deadline_at<UTC_TIMESTAMP(3)",
    [],
    req.query,
  );
});
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const t of await rows(
      pool,
      "SELECT * FROM repair_tickets WHERE sync_pending=1",
    )) {
      try {
        await sync(t);
      } catch {
        console.error("M3_SYNC_RETRY");
      }
    }
    for (const t of await rows(
      pool,
      "SELECT id FROM repair_tickets WHERE status NOT IN ('COMPLETED','CANCELLED') AND deadline_at<UTC_TIMESTAMP(3) AND escalation_count=0",
    ))
      await tx(async (c) => {
        const r = await one(
          c,
          "SELECT * FROM repair_tickets WHERE id=? FOR UPDATE",
          [t.id],
        );
        if (r.escalation_count || ["COMPLETED", "CANCELLED"].includes(r.status))
          return;
        await c.query(
          "UPDATE repair_tickets SET priority=LEAST(priority+1,3),escalation_count=1 WHERE id=?",
          [r.id],
        );
        await c.query(
          "INSERT INTO repair_progress(ticket_id,action_type,old_status,new_status,description) VALUES (?,'ESCALATE',?,?,'超过维修时限')",
          [r.id, r.status, r.status],
        );
        await event(c, "M3", null, "ESCALATE", r.id);
      });
    await deliver();
  } catch {
    console.error("M3_WORKER_RETRY");
  } finally {
    busy = false;
  }
}
finish(app, Number(process.env.PORT || 3003));
setInterval(tick, 5000).unref();
tick();
