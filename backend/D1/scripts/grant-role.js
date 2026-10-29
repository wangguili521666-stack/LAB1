// Explicit operator command; no public bootstrap endpoint or default privileged password.
import { pool } from "../src/db.js";
const [username, role] = process.argv.slice(2);
try {
  if (!username || !role)
    throw Error("用法：node scripts/grant-role.js <username> <role_code>");
  const [[u]] = await pool.query("SELECT id FROM users WHERE username=?", [
    username,
  ]);
  const [[r]] = await pool.query("SELECT id FROM roles WHERE role_code=?", [
    role,
  ]);
  if (!u || !r) throw Error("用户或角色不存在");
  await pool.query(
    "INSERT IGNORE INTO user_roles(user_id,role_id) VALUES (?,?)",
    [u.id, r.id],
  );
  console.log("角色授权成功");
} finally {
  await pool.end();
}
