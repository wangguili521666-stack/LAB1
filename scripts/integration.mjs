import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:15173";
const suffix = Date.now(),
  password = randomUUID();
let checks = 0;
async function api(
  path,
  token,
  body,
  method = body === undefined ? "GET" : "POST",
  expected = 200,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(j)}`);
  checks++;
  return j.data;
}
async function account(label, roles = []) {
  const username = `it_${suffix}_${label}`;
  const u = await api(
    "/api/d1/auth/register",
    null,
    { username, password },
    "POST",
    201,
  );
  for (const role of roles)
    process.env.TEST_LOCAL
      ? execFileSync(
          process.execPath,
          ["backend/D1/scripts/grant-role.js", username, role],
          { stdio: "pipe", env: process.env },
        )
      : execFileSync(
          "docker",
          [
            "compose",
            "exec",
            "-T",
            "d1",
            "node",
            "scripts/grant-role.js",
            username,
            role,
          ],
          { stdio: "pipe" },
        );
  const login = await api("/api/d1/auth/login", null, { username, password });
  return { id: u.user_id, token: login.access_token };
}
const admin = await account("admin", ["SYSTEM_ADMIN", "PROPERTY_ADMIN"]),
  student = await account("student"),
  other = await account("other"),
  worker = await account("worker", ["REPAIR_WORKER"]),
  teacher = await account("teacher", ["TEACHER"]);
const room = await api(
  "/api/d2/classrooms",
  admin.token,
  {
    building: "集成测试" + suffix,
    room_number: "101",
    capacity: 20,
    equipment: {},
    is_bookable_whole: true,
    open_time: "00:00:00",
    close_time: "23:59:59",
  },
  "POST",
  201,
);
const seat = await api(
  "/api/d2/seats",
  admin.token,
  { classroom_id: room.id, seat_number: "A1", socket_type: "FIXED" },
  "POST",
  201,
);
const tomorrow = new Date(Date.now() + 86400000);
tomorrow.setUTCHours(2, 0, 0, 0);
const start = tomorrow.toISOString(),
  end = new Date(+tomorrow + 3600000).toISOString();
const body = { seat_id: seat.id, start_time: start, end_time: end };
const race = await Promise.all(
  [student, other].map(async (u) => {
    const r = await fetch(base + "/api/m1/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + u.token,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: (await r.json()).data, u };
  }),
);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
checks++;
const winner = race.find((r) => r.status === 200),
  loser = race.find((r) => r.status === 409);
await api(
  `/api/m1/bookings/${winner.data.id}/cancel`,
  loser.u.token,
  {},
  "POST",
  403,
);
await api(
  "/api/m2/applications",
  teacher.token,
  {
    classroom_id: room.id,
    purpose: "集成测试",
    start_time: start,
    end_time: end,
  },
  "POST",
  409,
);
await api(`/api/m1/bookings/${winner.data.id}/cancel`, winner.u.token, {});
const application = await api(
  "/api/m2/applications",
  teacher.token,
  {
    classroom_id: room.id,
    purpose: "集成测试",
    start_time: start,
    end_time: end,
  },
  "POST",
  201,
);
await api(`/api/m2/applications/${application.id}/approve`, admin.token, {});
const approved = await api(
  `/api/m2/applications/${application.id}/approve`,
  admin.token,
  {},
);
assert.equal(approved.status, "APPROVED");
await api("/api/m1/bookings", student.token, body, "POST", 409);
const repairs = [];
for (let i = 0; i < 2; i++) {
  const t = await api("/api/m3/tickets", student.token, {
    repair_type_id: "1",
    classroom_id: room.id,
    location_description: "测试教室",
    description: "灯具损坏",
  });
  await api(
    `/api/m3/tickets/${t.id}/assign`,
    student.token,
    { worker_id: worker.id },
    "POST",
    403,
  );
  await api(`/api/m3/tickets/${t.id}/assign`, admin.token, {
    worker_id: worker.id,
  });
  await api(`/api/m3/tickets/${t.id}/start`, worker.token, {});
  repairs.push(t);
}
const later = new Date(+tomorrow + 7200000).toISOString(),
  laterEnd = new Date(+tomorrow + 10800000).toISOString();
const availability = () =>
  api(
    "/api/m1/seats/available?" +
      new URLSearchParams({
        start_time: later,
        end_time: laterEnd,
        classroom_id: room.id,
      }),
    student.token,
  );
assert.equal((await availability()).length, 0);
for (let i = 0; i < 2; i++) {
  const t = repairs[i];
  await api(`/api/m3/tickets/${t.id}/finish`, worker.token, {
    description: "已修复",
  });
  if (i === 0) {
    await api(`/api/m3/tickets/${t.id}/accept`, student.token, {
      accepted: false,
      comment: "仍有故障",
    });
    await api(`/api/m3/tickets/${t.id}/finish`, worker.token, {
      description: "返工完成",
    });
  }
  await api(`/api/m3/tickets/${t.id}/accept`, student.token, {
    accepted: true,
  });
  assert.equal((await availability()).length, i === 0 ? 0 : 1);
  await api(`/api/m3/tickets/${t.id}/review`, student.token, { rating: 5 });
  await api(
    `/api/m3/tickets/${t.id}/review`,
    student.token,
    { rating: 5 },
    "POST",
    409,
  );
}
// D1 dynamic RBAC and personal aggregation are exercised against real services.
await api('/api/d1/roles',student.token,undefined,'GET',403);
await api('/api/d1/users/'+student.id+'/roles',student.token,{role_codes:['SYSTEM_ADMIN']},'PUT',403);
await api('/api/d1/users/'+admin.id+'/roles',admin.token,{role_codes:[]},'PUT',409);
const custom=await api('/api/d1/roles',admin.token,{role_code:'TEST_ROLE_'+suffix,role_name:'测试申请角色'},'POST',201);
await api('/api/d1/roles/'+custom.id+'/permissions',admin.token,{permission_codes:['does:not:exist']},'PUT',400);
await api('/api/d1/roles/'+custom.id+'/permissions',admin.token,{permission_codes:['classroom:apply']},'PUT');
await api('/api/d1/users/'+other.id+'/roles',admin.token,{role_codes:['STUDENT',custom.role_code]},'PUT');
const refreshed=await api('/api/d1/users/me',other.token);assert.ok(refreshed.permissions.includes('classroom:apply'));
const customApplication=await api('/api/m2/applications',other.token,{classroom_id:room.id,purpose:'自定义角色授权验证',start_time:later,end_time:laterEnd},'POST',201);
await api('/api/m2/applications/'+customApplication.id+'/cancel',other.token,{});
await api('/api/d1/roles/'+custom.id+'/permissions',admin.token,{permission_codes:[]},'PUT');
await api('/api/m2/applications',other.token,{classroom_id:room.id,purpose:'撤权验证',start_time:later,end_time:laterEnd},'POST',403);
const records=await api('/api/d1/users/me/records',student.token);assert.equal(Object.keys(records).length,3);assert.ok(records.seat_bookings.items.every(r=>r.user_id===student.id));assert.ok(records.repair_tickets.items.every(r=>r.reporter_id===student.id));assert.ok(records.repair_tickets.items.length>=2);
await api('/api/d1/users/me/records?type=invalid',student.token,undefined,'GET',400);
await api('/api/d1/users/me/records?page_size=1000',student.token,undefined,'GET',400);
const paged=await api('/api/d1/users/me/records?type=repair_tickets&page_size=1',student.token);assert.equal(paged.repair_tickets.items.length,1);
console.log('PASS dynamic role grant/revoke, last-admin protection, private record aggregation and pagination');
if (process.env.TEST_LOCAL) {
  const { default: mysql } =
    await import("../backend/M1/node_modules/mysql2/promise.js");
  const cfg = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
  const db = await mysql.createConnection({
    ...cfg,
    database: process.env.DB_NAME.replace(/_d1$/, "_m1"),
  });
  const check = await api("/api/m1/bookings", student.token, {
    seat_id: seat.id,
    start_time: later,
    end_time: laterEnd,
  });
  await db.query(
    "UPDATE seat_bookings SET start_time=UTC_TIMESTAMP()-INTERVAL 5 MINUTE,end_time=UTC_TIMESTAMP()+INTERVAL 55 MINUTE WHERE id=?",
    [check.id],
  );
  await api(
    "/api/m1/admin/checkin-code/" + room.id,
    student.token,
    undefined,
    "GET",
    403,
  );
  const daily = await api("/api/m1/admin/checkin-code/" + room.id, admin.token);
  await api(
    `/api/m1/bookings/${check.id}/checkin`,
    student.token,
    { checkin_method: "CODE", code: "wrong" },
    "POST",
    400,
  );
  await api(`/api/m1/bookings/${check.id}/checkin`, student.token, {
    checkin_method: "CODE",
    code: daily.code,
  });
  const future = new Date(+tomorrow + 14400000).toISOString(),
    futureEnd = new Date(+tomorrow + 18000000).toISOString();
  const expired = await api("/api/m1/bookings", student.token, {
    seat_id: seat.id,
    start_time: future,
    end_time: futureEnd,
  });
  await db.query(
    "UPDATE seat_bookings SET start_time=UTC_TIMESTAMP()-INTERVAL 16 MINUTE,end_time=UTC_TIMESTAMP()+INTERVAL 44 MINUTE WHERE id=?",
    [expired.id],
  );
  const reminder = await api("/api/m1/bookings", student.token, {
    seat_id: seat.id,
    start_time: new Date(+tomorrow + 21600000).toISOString(),
    end_time: new Date(+tomorrow + 25200000).toISOString(),
  });
  await db.query(
    "UPDATE seat_bookings SET start_time=UTC_TIMESTAMP()+INTERVAL 10 MINUTE,end_time=UTC_TIMESTAMP()+INTERVAL 70 MINUTE WHERE id=?",
    [reminder.id],
  );
  await new Promise((r) => setTimeout(r, 16000));
  assert.equal(
    (await api("/api/m1/bookings/" + expired.id, student.token)).status,
    "NO_SHOW",
  );
  assert.ok(
    (await api("/api/m1/violations/me", student.token)).items.some(
      (v) => v.booking_id === expired.id,
    ),
  );
  const messages = await api("/api/d3/messages/me", student.token);
  assert.ok(
    messages.items.some((m) => m.notification_type === "BOOKING_REMINDER"),
  );
  assert.ok(messages.items.some((m) => m.notification_type === "NO_SHOW"));
  const again = await api("/api/m1/bookings", other.token, {
    seat_id: seat.id,
    start_time: future,
    end_time: futureEnd,
  });
  assert.equal(again.status, "BOOKED");
  await db.end();
  console.log(
    "PASS daily check-in, ownership, reminder delivery, no-show worker and D2 release",
  );
}
await new Promise((r) => setTimeout(r, 6000));
const logs = await api("/api/d3/admin/logs?page_size=100", admin.token);
for (const module of ["M1", "M2", "M3", "D2"])
  assert.ok(
    logs.items.some((l) => l.module === module),
    module + " 审计缺失",
  );
console.log(
  `PASS ${checks} HTTP assertions; concurrent booking, M2 approval exclusion, M3 rework/multiple-block restoration, four-module D3 audit`,
);
if(process.env.TEST_BROWSER_MODULE){
 const {chromium}=await import(process.env.TEST_BROWSER_MODULE);
 const browser=await chromium.launch({headless:true});
 try{const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(token=>localStorage.setItem('token',token),admin.token);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/role-admin');await page.getByRole('heading',{name:'角色与权限管理'}).waitFor();await page.getByLabel('角色编码').fill('BROWSER_'+suffix);await page.getByLabel('名称',{exact:true}).fill('浏览器验收角色');await page.getByRole('button',{name:'创建角色',exact:true}).click();await page.getByRole('button',{name:'浏览器验收角色',exact:true}).waitFor();await page.screenshot({path:'/tmp/lab1-role-admin.png',fullPage:true});
 await page.goto(base+'/profile');await page.getByRole('heading',{name:'我的业务记录'}).waitFor();await page.getByText('暂无记录',{exact:true}).waitFor();
 await page.goto(base+'/checkin-screen');await page.getByLabel('教室 ID').fill(room.id);await page.getByRole('button',{name:'展示签到码'}).click();await page.locator('.code').waitFor();assert.match(await page.locator('.code').textContent(),/^\d{6}$/);await page.screenshot({path:'/tmp/lab1-checkin-screen.png',fullPage:true});
 await page.route('**/api/m1/admin/checkin-code/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'DEPENDENCY_UNAVAILABLE',message:'测试连接故障'})}));await page.getByRole('button',{name:'展示签到码'}).click();await page.getByText('测试连接故障',{exact:true}).waitFor();assert.equal(await page.locator('.code').count(),0);assert.deepEqual(errors,[]);console.log('PASS browser role creation, personal records, six-digit classroom display and failure hides stale code');
 }finally{await browser.close()}
}
