// Isolated database integration runner. Explicit source env path required; never changes source databases.
import { readFileSync, openSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import mysql from "../backend/M1/node_modules/mysql2/promise.js";
import { parse } from "../backend/M1/node_modules/dotenv/lib/main.js";
if (!process.env.TEST_DB_ENV_FILE)
  throw Error("Set TEST_DB_ENV_FILE to a MySQL administrator .env file");
const source = parse(readFileSync(process.env.TEST_DB_ENV_FILE));
const prefix = "lab1_it_" + Date.now();
const children = [];
const key = () => randomBytes(32).toString("hex");
const jwt = key(),
  d1token = key(),
  checkin = key();
const d2keys = { M1: key(), M2: key(), M3: key() },
  d3keys = { M1: key(), M2: key(), M3: key(), D2: key(), D1: key() };
const db = {
  DB_HOST: "127.0.0.1",
  DB_PORT: source.MYSQL_PORT || "3306",
  DB_USER: "root",
  DB_PASSWORD: source.MYSQL_ROOT_PASSWORD,
};
const c = await mysql.createConnection({
  host: db.DB_HOST,
  port: Number(db.DB_PORT),
  user: db.DB_USER,
  password: db.DB_PASSWORD,
});
const envs = {};
for (const [m, port] of [
  ["M1", 19001],
  ["M2", 19002],
  ["M3", 19003],
  ["D1", 19004],
  ["D2", 19005],
  ["D3", 19006],
]) {
  const database = prefix + "_" + m.toLowerCase();
  await c.query("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4");
  envs[m] = {
    ...process.env,
    ...db,
    DB_NAME: database,
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_TIMEZONE: "+00:00",
    JWT_SECRET: jwt,
    M1_BASE_URL: "http://127.0.0.1:19001", M2_BASE_URL: "http://127.0.0.1:19002", M3_BASE_URL: "http://127.0.0.1:19003", D1_BASE_URL: "http://127.0.0.1:19004",
    D2_BASE_URL: "http://127.0.0.1:19005",
    D3_BASE_URL: "http://127.0.0.1:19006",
    D1_SERVICE_TOKEN: d1token,
    D1_M2_SERVICE_TOKEN: d1token,
    D2_SERVICE_TOKEN: d2keys[m] || "",
    D3_SERVICE_TOKEN: d3keys[m] || "",
    D2_M1_SERVICE_TOKEN: d2keys.M1,
    D2_M2_SERVICE_TOKEN: d2keys.M2,
    D2_M3_SERVICE_TOKEN: d2keys.M3,
    D3_SERVICE_TOKENS: JSON.stringify(d3keys),
    CHECKIN_SECRET: checkin,
  };
}
await c.end();
try {
  for (const m of ["D1", "D2", "D3", "M1", "M2", "M3"]) {
    execFileSync(
      process.execPath,
      [["M1", "M3"].includes(m) ? "migrate.js" : "scripts/migrate.js"],
      { cwd: "backend/" + m, env: envs[m], stdio: "pipe" },
    );
    children.push(
      spawn(process.execPath, ["src/index.js"], {
        cwd: "backend/" + m,
        env: envs[m],
        stdio: [
          "ignore",
          openSync("/tmp/lab1-" + m + ".log", "w"),
          openSync("/tmp/lab1-" + m + "-error.log", "w"),
        ],
      }),
    );
  }
  const frontEnv = { ...process.env };
  for (const [m, e] of Object.entries(envs))
    frontEnv[m + "_API_TARGET"] = "http://127.0.0.1:" + e.PORT;
  children.push(
    spawn(
      process.execPath,
      [
        "frontend/node_modules/vite/bin/vite.js",
        "frontend",
        "--port",
        "15174",
        "--configLoader",
        "runner",
      ],
      {
        env: frontEnv,
        stdio: [
          "ignore",
          openSync("/tmp/lab1-vite.log", "w"),
          openSync("/tmp/lab1-vite-error.log", "w"),
        ],
      },
    ),
  );
  for (let i = 0; i < 60; i++) {
    try {
      const results = await Promise.all(
        Object.keys(envs).map((m) =>
          fetch(
            "http://127.0.0.1:15174/api/" + m.toLowerCase() + "/health",
          ).then((r) => r.ok),
        ),
      );
      if (results.every(Boolean)) break;
    } catch {}
    if (i === 59) throw Error("Health timeout; inspect /tmp/lab1-*.log");
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("All six services healthy; isolated database prefix " + prefix);
  execFileSync(process.execPath, ["scripts/integration.mjs"], {
    env: {
      ...envs.D1,
      TEST_LOCAL: "1",
      TEST_BASE_URL: "http://127.0.0.1:15174",
    },
    stdio: "inherit",
  });
} finally {
  for (const child of children) child.kill("SIGTERM");
  const cleanup=setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill("SIGKILL")},5000);cleanup.unref();
}
