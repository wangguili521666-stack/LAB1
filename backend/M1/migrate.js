import { pool, rows } from "./src/common.js";
import { readFile, readdir } from "node:fs/promises";
const c = await pool.getConnection();
try {
  const [[lock]]=await c.query("SELECT GET_LOCK(?,30) acquired",[process.env.DB_NAME+"_migration"]);
  if(Number(lock.acquired)!==1)throw Error("无法获得迁移锁");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY)",
  );
  for (const f of (
    await readdir(new URL("./migrations/", import.meta.url))
  ).sort()) {
    if (
      (
        await rows(
          c,
          "SELECT filename FROM schema_migrations WHERE filename=?",
          [f],
        )
      ).length
    )
      continue;
    for (const sql of (
      await readFile(new URL("./migrations/" + f, import.meta.url), "utf8")
    )
      .split(";")
      .filter((s) => s.trim()))
      await c.query(sql);
    await c.query("INSERT INTO schema_migrations VALUES (?)", [f]);
  }
} finally {
  await c.query("SELECT RELEASE_LOCK(?)",[process.env.DB_NAME+"_migration"]);
  c.release();
  await pool.end();
}
