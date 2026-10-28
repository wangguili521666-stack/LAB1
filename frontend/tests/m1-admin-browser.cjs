const { chromium } = require(process.env.M1_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const base = process.env.M1_PREVIEW_URL || "http://127.0.0.1:5174",
  output = process.env.M1_QA_OUTPUT || path.resolve("tests/artifacts/m1-admin");
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
      headless: true,
      ...(process.env.M1_BROWSER_PATH
        ? { executablePath: process.env.M1_BROWSER_PATH }
        : {}),
    }),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const pass = (name) => {
    checks.push(name);
    console.log("PASS " + name);
  };
  const admin = page.locator(".m1-admin"),
    rows = page.locator(".admin-records li"),
    modal = page.locator(".admin-dialog");
  async function scenario(mode = "admin") {
    await page.request.post(base + "/__m1_preview?mode=" + mode);
    const profile = page.waitForResponse((r) =>
      r.url().endsWith("/api/d1/users/me"),
    );
    await page.goto(base + "/tests/m1-preview.html");
    await profile;
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".m1-admin")
          ?.textContent.includes("正在确认管理权限"),
    );
  }
  async function expand() {
    await page
      .getByRole("button", { name: "展开管理工作台", exact: true })
      .click();
  }
  async function settings() {
    await expand();
    await admin.getByRole("button", { name: "预约配置", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑配置 max_booking_hours", exact: true })
      .waitFor();
  }
  async function inspect() {
    return (await (await page.request.get(base + "/__m1_preview")).json()).data;
  }
  try {
    let adminRequests = 0;
    page.on("request", (r) => {
      if (
        r.url().includes("/api/m1/admin/") ||
        r.url().includes("/api/m1/settings")
      )
        adminRequests++;
    });
    await scenario("success");
    assert.equal(await admin.count(), 0);
    assert.equal(adminRequests, 0);
    pass("student has no management entry and sends no management requests");
    await scenario("operator");
    await expand();
    await rows.first().waitFor();
    assert.equal(
      await admin
        .getByRole("button", { name: "预约配置", exact: true })
        .count(),
      0,
    );
    await admin.getByRole("button", { name: "预约统计", exact: true }).click();
    await page.locator("[data-metric=total_bookings]").waitFor();
    pass(
      "operational role can read list and statistics without configuration entry",
    );
    await scenario("classroom-admin");
    await expand();
    await rows.first().waitFor();
    assert.equal(
      await admin
        .getByRole("button", { name: "预约配置", exact: true })
        .count(),
      0,
    );
    pass("classroom role is read-only");
    await scenario();
    await expand();
    await page.waitForFunction(
      () => document.querySelectorAll(".admin-records li").length === 20,
    );
    await page
      .getByRole("navigation", { name: "管理预约分页" })
      .getByRole("button", { name: "下一页" })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".admin-records li").length === 6,
    );
    await page.locator("#admin-status").selectOption("COMPLETED");
    await page
      .getByRole("button", { name: "查询管理预约", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".admin-records li").length === 5,
    );
    pass("management pagination and filter reset show correct records");
    await page.locator("#admin-room").fill("202");
    await page
      .getByRole("button", { name: "查询管理预约", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".admin-records li").length === 1,
    );
    assert.match(await rows.first().innerText(), /座位编号 303/);
    pass("classroom filter is sent to server and reflected in results");
    await admin.getByRole("button", { name: "预约统计", exact: true }).click();
    await page.locator("[data-metric=total_bookings]").waitFor();
    assert.equal(
      await page.locator("[data-metric=total_bookings]").innerText(),
      "26",
    );
    assert.equal(
      await page.locator("[data-metric=completed_bookings]").innerText(),
      "5",
    );
    pass("statistics show server-provided total and status counts");
    await scenario("admin-missing-stats");
    await expand();
    await admin.getByRole("button", { name: "预约统计", exact: true }).click();
    await page.locator("[data-metric=no_show_bookings]").waitFor();
    assert.equal(
      await page.locator("[data-metric=no_show_bookings]").innerText(),
      "—",
    );
    await page
      .getByText("部分统计数据未提供，不能视为零。", { exact: true })
      .waitFor();
    pass("missing metric is not rendered as zero");
    await scenario("admin-empty");
    await expand();
    await admin.getByText("暂无符合条件的预约。", { exact: true }).waitFor();
    await admin.getByRole("button", { name: "预约统计", exact: true }).click();
    await page.locator("[data-metric=total_bookings]").waitFor();
    assert.equal(
      await page.locator("[data-metric=total_bookings]").innerText(),
      "0",
    );
    await admin.getByRole("button", { name: "预约配置", exact: true }).click();
    await page
      .getByText("系统尚未返回可配置的参数。", { exact: true })
      .waitFor();
    pass("empty lists and actual zero statistics are handled separately");
    await scenario("admin-denied");
    await expand();
    await admin.getByRole("alert").filter({ hasText: "拒绝访问" }).waitFor();
    assert.equal(await rows.count(), 0);
    assert.equal(await page.locator("#admin-content").count(), 0);
    pass("403 clears management data and hides controls");
    await scenario();
    await settings();
    await page
      .getByRole("button", { name: "编辑配置 max_booking_hours", exact: true })
      .click();
    await modal.waitFor();
    await page.locator("#setting-value").fill("6");
    await page
      .getByRole("button", { name: "确认保存", exact: true })
      .evaluate((b) => {
        b.click();
        b.click();
      });
    await admin.getByText("配置已保存。", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector(".admin-settings")
        .textContent.includes("当前值：6"),
    );
    const data = await inspect();
    assert.equal(data.mutations, 1);
    assert.equal(
      data.settings.find((x) => x.setting_key === "checkin_reminder_minutes")
        .setting_value,
      "10",
    );
    pass("configuration saves one exact key once and rereads result");
    await scenario("admin-setting-rejected");
    await settings();
    await page
      .getByRole("button", { name: "编辑配置 max_booking_hours", exact: true })
      .click();
    await page.locator("#setting-value").fill("bad");
    await page.getByRole("button", { name: "确认保存", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "须为" }).waitFor();
    assert.equal(
      (await inspect()).settings.find(
        (x) => x.setting_key === "max_booking_hours",
      ).setting_value,
      "4",
    );
    assert.equal(await page.locator("#setting-value").inputValue(), "bad");
    pass("invalid setting keeps original value and editable draft");
    await scenario("admin-save-refresh-error");
    await settings();
    await page
      .getByRole("button", { name: "编辑配置 max_booking_hours", exact: true })
      .click();
    await page.locator("#setting-value").fill("6");
    await page.getByRole("button", { name: "确认保存", exact: true }).click();
    await admin.getByText("配置已保存。", { exact: true }).waitFor();
    await admin
      .getByRole("alert")
      .filter({ hasText: "不要重复保存" })
      .waitFor();
    pass("save success is preserved when rereading settings fails");
    await scenario();
    await expand();
    await admin.getByRole("button", { name: "预约统计", exact: true }).click();
    await page.locator("[data-metric=total_bookings]").waitFor();
    await page.locator("#admin-stat-title").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, "m1-admin-statistics.png"),
    });
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await admin
        .getByRole("button", { name: "预约配置", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "编辑配置 max_booking_hours",
          exact: true,
        })
        .click();
      await modal.waitFor();
      assert.equal(
        await modal.evaluate(
          (e) => e.getBoundingClientRect().width <= innerWidth,
        ),
        true,
      );
      if (width === 375)
        await page.screenshot({
          path: path.join(output, "m1-admin-setting-mobile.png"),
        });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.getAttribute("aria-label"),
        ),
        "编辑配置 max_booking_hours",
      );
    }
    pass(
      "management views and configuration dialog fit all three widths with keyboard focus restoration",
    );
    assert.deepEqual(errors, []);
    pass("no browser runtime errors");
    await fs.writeFile(
      path.join(output, "admin-browser-results.json"),
      JSON.stringify(
        { interface: "local fixtures, not real authorization", checks, errors },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
