import {permissions} from '../rbac.js';
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { ok, fail } from "../utils/response.js";
import { authRequired } from "../middleware/auth.js";
const router = Router(),
  wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
async function user(id) {
  const [[u]] = await pool.query(
    "SELECT id,username,nickname,college_id,status FROM users WHERE id=?",
    [id],
  );
  if (!u) return null;
  const [rs] = await pool.query(
    "SELECT role_code FROM roles JOIN user_roles ON roles.id=user_roles.role_id WHERE user_id=?",
    [id],
  );
  return {
    ...u,
    id: String(u.id),
    college_id: u.college_id ? String(u.college_id) : null,
    roles: rs.map((r) => r.role_code),
    permissions: await permissions(id),
  };
}
router.post(
  "/internal/authorize",
  wrap(async (req, res) => {
    const expected = process.env.D1_M2_SERVICE_TOKEN || "",
      actual = req.get("X-Service-Token") || "";
    if (
      expected.length < 32 ||
      actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return res.status(401).json(fail("UNAUTHORIZED", "服务认证失败"));
    const u = await user(req.body.user_id);
    let allowed = false,
      reason = "PERMISSION_DENIED";
    if (u?.status === "ACTIVE") {
      const ps=await permissions(u.id);
      allowed=ps.includes(req.body.permission_code);
      if (
        allowed &&
        req.body.resource_college_id &&
        !u.roles.includes("SYSTEM_ADMIN") &&
        req.body.resource_college_id !== u.college_id
      ) {
        allowed = false;
        reason = "COLLEGE_MISMATCH";
      }
    } else reason = "ACCOUNT_DISABLED";
    res.json(ok({ allowed, reason: allowed ? null : reason }));
  }),
);
router.use(authRequired);
// All endpoints below re-check current database roles, rather than trusting JWT role claims.
router.get(
  "/colleges",
  wrap(async (req, res) => {
    const u = await user(req.user.id);
    if (u?.status !== "ACTIVE")
      return res.status(403).json(fail("FORBIDDEN", "账号不可用"));
    const [r] = await pool.query("SELECT id,name FROM colleges");
    res.json(ok(r));
  }),
);
router.get(
  "/admin/users/:id",
  wrap(async (req, res) => {
    const u = await user(req.user.id);
    if (
      u?.status !== "ACTIVE" ||
      !u.roles.includes("SYSTEM_ADMIN")&&!u.permissions.includes("repair:manage")
    )
      return res.status(403).json(fail("FORBIDDEN", "权限不足"));
    const target = await user(req.params.id);
    if (!target) return res.status(404).json(fail("NOT_FOUND", "用户不存在"));
    res.json(ok(target));
  }),
);
export default router;
