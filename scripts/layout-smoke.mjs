import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dataDir = await mkdtemp(path.join(tmpdir(), "spine-shelf-layout-"));
const env = {
  ...process.env,
  SPINE_SHELF_DATA: dataDir,
  SPINE_SHELF_TEST: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
await mkdir("test-results", { recursive: true });
async function launch() {
  app = await electron.launch({
    ...(process.env.SPINE_SHELF_EXECUTABLE
      ? { executablePath: process.env.SPINE_SHELF_EXECUTABLE, args: [] }
      : { args: ["."] }),
    cwd: process.cwd(),
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1320, 900),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "预览 spineboy-pro", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".ready-dot")?.textContent === "已就绪",
  );
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
  });
  return page;
}
const paneWidth = (page) =>
  page
    .locator(".preview-pane")
    .evaluate((e) => e.getBoundingClientRect().width);
async function expectWidth(page, width) {
  await page.waitForFunction(
    (w) =>
      Math.abs(
        document.querySelector(".preview-pane").getBoundingClientRect().width -
          w,
      ) < 1,
    width,
  );
}
async function dragBy(page, dx, release = true) {
  const handle = await page.getByRole("separator").boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + dx,
    handle.y + handle.height / 2,
    { steps: 15 },
  );
  if (release) await page.mouse.up();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function layoutFits(page) {
  const dims = await page.evaluate(() => {
    const main = document.querySelector(".main");
    const grid = document.querySelector(".asset-grid");
    const canvas = document.querySelector(".stage canvas");
    return {
      main: main.clientWidth,
      scroll: main.scrollWidth,
      grid: grid.clientWidth,
      gridScroll: grid.scrollWidth,
      doc: document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      canvas: canvas.clientWidth,
      canvasPixels: canvas.width,
    };
  });
  assert.ok(dims.main >= 419, JSON.stringify(dims));
  assert.ok(dims.scroll <= dims.main + 1, JSON.stringify(dims));
  assert.ok(dims.gridScroll <= dims.grid + 1, JSON.stringify(dims));
  assert.ok(dims.docScroll <= dims.doc + 1, JSON.stringify(dims));
  assert.ok(dims.canvas > 0 && dims.canvasPixels >= dims.canvas);
}
async function tooltip(page, label, text) {
  await page.mouse.move(300, 80);
  await page.getByRole("button", { name: label, exact: true }).hover();
  await page.getByRole("tooltip").waitFor({ state: "visible" });
  assert.equal(await page.getByRole("tooltip").textContent(), text);
  const box = await page.getByRole("tooltip").boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width &&
      box.y + box.height <= viewport.height,
  );
}
try {
  let page = await launch();
  const initial = await paneWidth(page);
  assert.equal(initial, 352);
  await dragBy(page, -160);
  await expectWidth(page, initial + 160);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("spine-shelf.preview-width"),
    ),
    "512",
  );
  await layoutFits(page);
  await dragBy(page, 500);
  await expectWidth(page, 320);
  await dragBy(page, -900);
  const maximum = Number(
    await page.getByRole("separator").getAttribute("aria-valuemax"),
  );
  await expectWidth(page, maximum);
  await layoutFits(page);
  await dragBy(page, 80, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectWidth(page, maximum);
  await page.locator("body.resizing-preview").waitFor({ state: "detached" });

  await page.getByRole("separator").focus();
  await page.keyboard.press("Home");
  await expectWidth(page, 320);
  await page.keyboard.press("ArrowLeft");
  await expectWidth(page, 336);
  await page.keyboard.press("Shift+ArrowLeft");
  await expectWidth(page, 386);
  await page.getByRole("separator").dblclick();
  await expectWidth(page, initial);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("spine-shelf.preview-width"),
    ),
    null,
  );
  await dragBy(page, -248);
  await expectWidth(page, 600);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1120, 800),
  );
  await page.waitForFunction(() => innerWidth === 1120);
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('[role="separator"]')
          .getAttribute("aria-valuemax"),
      ) < 600,
  );
  await expectWidth(
    page,
    Number(await page.getByRole("separator").getAttribute("aria-valuemax")),
  );
  await layoutFits(page);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1320, 900),
  );
  await expectWidth(page, 600);
  await page.getByRole("button", { name: "放大预览", exact: true }).click();
  await page.locator(".viewer-panel.expanded").waitFor();
  assert.equal(await page.getByRole("separator").isVisible(), false);
  await page.getByRole("button", { name: "收起预览", exact: true }).click();
  await expectWidth(page, 600);

  await app.close();
  page = await launch();
  await expectWidth(page, 600);
  await layoutFits(page);
  const checks = [
    ["显示骨骼", "显示骨骼：查看骨骼结构"],
    ["水平翻转", "水平翻转：左右镜像预览"],
    ["保存截图", "截图：将当前帧保存为透明 PNG"],
    ["背景 grid", "网格背景"],
    ["背景 light", "浅色背景"],
    ["缩小", "缩小动画预览（也可滚轮缩放）"],
    ["放大", "放大动画预览（也可滚轮缩放）"],
    ["适应画布", "适应画布：居中并重置缩放（F）"],
    ["暂停", "暂停播放（空格）"],
    ["收藏资源", "收藏此资源，方便下次查找"],
    ["资源操作", "资源操作：打开文件夹或移除资源"],
    ["列表视图", "列表视图"],
  ];
  for (const [label, text] of checks) await tooltip(page, label, text);
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "保存截图", exact: true }).focus();
  await page.getByRole("tooltip").waitFor({ state: "visible" });
  assert.equal(
    await page
      .getByRole("button", { name: "保存截图", exact: true })
      .getAttribute("aria-describedby"),
    "shelf-control-tooltip",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  await tooltip(page, "水平翻转", "水平翻转：左右镜像预览");
  await page.screenshot({ path: "test-results/layout-tooltip.png" });
  await page.mouse.move(300, 80);
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await layoutFits(page);
  await page.getByRole("button", { name: "网格视图", exact: true }).click();
  await page.screenshot({ path: "test-results/layout-wide-preview.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: drag, limits, cancel, keyboard, reset, responsive grid/canvas, expanded preview, restart persistence and explanatory tooltips",
  );
} catch (error) {
  console.error(error);
  if (app) {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].showInactive(),
    );
    const page = await app.firstWindow();
    console.log(
      "FAILED STATE",
      await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.querySelector(".preview-pane")?.clientWidth,
        body: document.body.className,
        active: document.activeElement?.tagName,
      })),
    );
    await page.screenshot({ path: "test-results/layout-failure.png" });
  }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
