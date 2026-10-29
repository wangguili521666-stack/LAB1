const { chromium } = require(process.env.M1_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const base = process.env.M1_PREVIEW_URL || "http://127.0.0.1:5174";
const output =
  process.env.M1_QA_OUTPUT || path.resolve("tests/artifacts/m1-personal");
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
    }),
    errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pass = (name) => {
    checks.push(name);
    console.log("PASS " + name);
  };
  const rows = page.locator(".personal-record"),
    modal = page.locator(".personal-dialog");
  async function scenario(mode = "history") {
    await page.request.post(base + "/__m1_preview?mode=" + mode);
    await page.goto(base + "/tests/m1-preview.html");
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 20,
    );
  }
  async function open(name) {
    await page.getByRole("button", { name, exact: true }).click();
    await modal.waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".personal-dialog")
          .textContent.includes("正在读取"),
    );
  }
  async function inspect() {
    return (await (await page.request.get(base + "/__m1_preview")).json()).data;
  }
  try {
    await scenario();
    await page
      .getByRole("navigation", { name: "预约记录分页" })
      .getByRole("button", { name: "下一页" })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 6,
    );
    pass("booking pagination loads page two");
    await page.locator("#record-status").selectOption("COMPLETED");
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 5,
    );
    await page.getByText("共 5 条", { exact: true }).waitFor();
    pass("status filter resets page and shows matching total");
    await open("查看预约 505 详情");
    await modal.getByText("已完成", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "查看预约 505 详情",
    );
    pass("details read latest record and restore keyboard focus");
    await scenario();
    await open("签到预约 501");
    await page.getByRole("button", { name: "确认签到", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "请输入" }).waitFor();
    assert.equal((await inspect()).mutations, 0);
    await page.locator("#checkin-code").fill("bad");
    await page.getByRole("button", { name: "确认签到", exact: true }).click();
    await modal
      .getByRole("alert")
      .filter({ hasText: "错误或已过期" })
      .waitFor();
    pass("blank and invalid checkin code do not create a success");
    await page.locator("#checkin-code").fill("482916");
    await page
      .getByRole("button", { name: "确认签到", exact: true })
      .evaluate((b) => {
        b.click();
        b.click();
      });
    await page.getByText("签到成功，祝你学习顺利。", { exact: true }).waitFor();
    await rows
      .filter({ hasText: "预约编号 501" })
      .getByText("已签到", { exact: true })
      .waitFor();
    assert.equal((await inspect()).mutations, 1);
    pass("checkin submits once and reloads actual checked-in state");
    await scenario();
    await page.locator("#record-status").selectOption("BOOKED");
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 6,
    );
    await open("取消预约 501");
    await modal.getByRole("button", { name: "返回", exact: true }).click();
    assert.equal((await inspect()).mutations, 0);
    await open("取消预约 501");
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await page.getByText("预约已取消。", { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 5,
    );
    assert.equal(await rows.filter({ hasText: "预约编号 501" }).count(), 0);
    pass(
      "cancel confirmation can be dismissed and successful cancel preserves active filter",
    );
    await scenario();
    await open("再次预约 505");
    await page.locator("#rebook-start").fill("2026-11-01T09:00");
    await page.locator("#rebook-end").fill("2026-11-01T11:00");
    await page
      .getByRole("button", { name: "确认再次预约", exact: true })
      .click();
    await modal.getByRole("alert").filter({ hasText: "占用" }).waitFor();
    assert.equal(
      await page.locator("#rebook-start").inputValue(),
      "2026-11-01T09:00",
    );
    pass("rebook conflict preserves editable new interval");
    await page.locator("#rebook-start").fill("2026-11-02T09:00");
    await page.locator("#rebook-end").fill("2026-11-02T11:00");
    await page
      .getByRole("button", { name: "确认再次预约", exact: true })
      .click();
    await page
      .getByText("再次预约成功，请按新时段到达并签到。", { exact: true })
      .waitFor();
    const data = await inspect();
    assert.equal(data.bookings[0].start_time, "2026-11-02T09:00:00+08:00");
    assert.equal(data.bookings.find((b) => b.id === "505").status, "COMPLETED");
    pass("rebook creates new record without altering original");
    await page
      .getByRole("button", { name: "查看违约记录", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-violations li").length === 20,
    );
    await page
      .getByRole("navigation", { name: "违约记录分页" })
      .getByRole("button", { name: "下一页" })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-violations li").length === 3,
    );
    await page
      .getByRole("button", { name: "查看关联预约 504", exact: true })
      .first()
      .click();
    await modal.getByText("未签到违约", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    pass("violation pagination links to associated booking details");
    await scenario("forbidden");
    await open("取消预约 501");
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "无权" }).waitFor();
    assert.equal(
      await modal
        .getByRole("button", { name: "确认取消", exact: true })
        .count(),
      0,
    );
    pass("403 blocks repeated unauthorized action");
    await scenario("missing");
    await open("查看预约 501 详情");
    await modal.getByRole("alert").filter({ hasText: "不存在" }).waitFor();
    pass("404 detail is readable and dismissible");
    await scenario("personal-refresh-error");
    await open("取消预约 501");
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await page.getByText("预约已取消。", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "不要重复提交" }).waitFor();
    pass("successful cancellation remains successful after refresh failure");
    await scenario();
    await page.locator("#record-status").selectOption("COMPLETED");
    await page.waitForFunction(
      () => document.querySelectorAll(".personal-record").length === 5,
    );
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#records-title").scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      if (width === 1440)
        await page.screenshot({
          path: path.join(output, "m1-history-desktop.png"),
        });
      await open("再次预约 505");
      assert.equal(
        await modal.evaluate(
          (e) => e.getBoundingClientRect().width <= innerWidth,
        ),
        true,
      );
      if (width === 375)
        await page.screenshot({
          path: path.join(output, "m1-rebook-mobile.png"),
        });
      await page.keyboard.press("Escape");
    }
    pass("personal records and forms fit desktop tablet and phone");
    assert.deepEqual(errors, []);
    pass("no browser runtime errors");
    await fs.writeFile(
      path.join(output, "personal-browser-results.json"),
      JSON.stringify(
        { interface: "mock HTTP fixtures, not real backend", checks, errors },
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
