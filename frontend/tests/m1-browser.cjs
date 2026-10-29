// Optional browser acceptance: install Playwright separately, or set M1_PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.M1_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.M1_PREVIEW_URL || "http://127.0.0.1:5174";
const output = process.env.M1_QA_OUTPUT || path.resolve("tests/artifacts/m1");
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.M1_BROWSER_PATH
      ? { executablePath: process.env.M1_BROWSER_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [],
    results = [];
  let writes = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname === "/api/m1/bookings"
    )
      writes++;
  });
  const check = (name) => {
    results.push(name);
    console.log("PASS " + name);
  };
  async function scenario(mode = "success") {
    await page.request.post(base + "/__m1_preview?mode=" + mode);
    await page.goto(base + "/tests/m1-preview.html");
    await page.locator("#m1-start").fill("2026-11-01T09:00");
    await page.locator("#m1-end").fill("2026-11-01T11:00");
  }
  async function search(count) {
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".m1-seat").length === n,
      count,
    );
  }
  try {
    await scenario();
    await page.getByText("你的专注时光，从这里开始").waitFor();
    check("initial view distinguishes not searched from no results");
    await page.locator("#m1-end").fill("2026-11-01T14:00");
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "不能超过 4 小时" })
      .waitFor();
    check("five-hour validation visible");
    await page.locator("#m1-end").fill("2026-11-01T11:00");
    await search(3);
    await page.locator("#m1-socket").selectOption("FIXED");
    assert.equal(
      await page
        .getByRole("button", { name: "预约座位 A01", exact: true })
        .isDisabled(),
      true,
    );
    await search(1);
    await page
      .getByRole("button", { name: "预约座位 A01", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector(".m1-dialog").open,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "预约座位 A01",
    );
    check("socket filter, stale guard and keyboard modal focus restoration");
    await scenario("slow");
    await search(3);
    await page
      .getByRole("button", { name: "预约座位 A01", exact: true })
      .click();
    const before = writes;
    await page
      .getByRole("button", { name: "确认预约", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page
      .getByText("预约成功。请按时到达并签到。", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".m1-record-list li").length === 1,
    );
    assert.equal(writes - before, 1);
    assert.equal(await page.locator(".m1-seat").count(), 2);
    check("successful booking posts once and refreshes seats and records");
    await scenario("conflict");
    await search(3);
    await page
      .getByRole("button", { name: "预约座位 A01", exact: true })
      .click();
    await page.getByRole("button", { name: "确认预约", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "已不可预约" }).waitFor();
    assert.equal(
      await page.locator(".m1-dialog").evaluate((el) => el.open),
      false,
    );
    check("409 conflict closes confirmation and remains actionable");
    await scenario("refresh-error");
    await search(3);
    await page
      .getByRole("button", { name: "预约座位 A01", exact: true })
      .click();
    await page.getByRole("button", { name: "确认预约", exact: true }).click();
    await page
      .getByText("预约成功。请按时到达并签到。", { exact: true })
      .waitFor();
    await page.getByRole("alert").filter({ hasText: "记录加载失败" }).waitFor();
    check("write success remains visible when follow-up reads fail");
    await scenario("empty");
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page.getByText("暂无符合条件的座位", { exact: true }).waitFor();
    check("empty results are clearly explained");
    await scenario("error");
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "服务暂不可用" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "查询座位", exact: true })
        .isEnabled(),
      true,
    );
    check("503 feedback allows retry");
    await scenario();
    await page.route("**/api/m1/seats/available?*", (route) => route.abort());
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "无法连接服务" }).waitFor();
    await page.unroute("**/api/m1/seats/available?*");
    check("network failure is readable");
    await scenario();
    await search(3);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `overflow at ${width}`,
      );
      await page
        .getByRole("button", { name: "预约座位 A01", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
        true,
      );
      await page.keyboard.press("Escape");
      if (width !== 768)
        await page.screenshot({
          path: path.join(output, `m1-preview-${width}.png`),
          fullPage: true,
        });
    }
    check("375/768/1440 layouts and dialog fit without horizontal overflow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/m1");
    await page.getByRole("heading", { name: "查找空闲座位" }).waitFor();
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `app shell overflow ${width}`,
      );
    }
    check("existing app shell and navigation render M1 at all three widths");
    await page.route("**/api/m1/seats/available?*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "UNAUTHORIZED",
          message: "登录已过期",
          data: null,
        }),
      }),
    );
    await page.getByRole("button", { name: "查询座位", exact: true }).click();
    await page.waitForURL("**/login?redirect=**");
    check("401 returns actual application to login");
    assert.deepEqual(errors, []);
    check("no browser runtime errors");
    await fs.writeFile(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          interface: "local fixtures, not real backend",
          results,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
