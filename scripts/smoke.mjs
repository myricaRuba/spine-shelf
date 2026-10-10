import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dataDir = await mkdtemp(path.join(tmpdir(), "spine-shelf-e2e-"));
await mkdir("test-results", { recursive: true });
const env = {
  ...process.env,
  SPINE_SHELF_DATA: dataDir,
  SPINE_SHELF_TEST: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
async function launch() {
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE ERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("Thumbnail"))
      console.log(message.text());
  });
  await page.waitForSelector(".asset-card", { timeout: 60000 });
  return page;
}
async function verifyPixels(page) {
  const visible = await page
    .locator(".stage canvas")
    .evaluate(async (canvas) => {
      const image = new window.Image();
      image.src = canvas.toDataURL("image/png");
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      const context = copy.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 30) painted++;
      return painted;
    });
  assert.ok(
    visible > 1000,
    `Expected an actual rendered skeleton; got ${visible} painted pixels`,
  );
}
try {
  let page = await launch();
  let data = await page.evaluate(() => window.shelf.getLibrary());
  assert.equal(data.assets.length, 4);
  for (const asset of data.assets) {
    await page
      .getByRole("button", { name: `预览 ${asset.name}`, exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".ready-dot")?.textContent === "已就绪",
      { timeout: 30000 },
    );
    await verifyPixels(page);
    console.log("RENDER PASS", asset.name, asset.version);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".asset-image img").length === 4,
    { timeout: 60000 },
  );
  await page
    .getByRole("button", { name: "预览 spineboy-pro", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".ready-dot")?.textContent === "已就绪",
  );
  await page.getByLabel("动画", { exact: true }).selectOption("run");
  await page.getByLabel("播放速度").selectOption("0.5");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const before = await page.getByLabel("播放进度").inputValue();
  await page.waitForTimeout(200);
  assert.equal(await page.getByLabel("播放进度").inputValue(), before);
  await page.getByLabel("播放进度").fill("0.2");
  await verifyPixels(page);
  await page.getByRole("button", { name: "显示骨骼", exact: true }).click();
  await page.getByRole("button", { name: "水平翻转", exact: true }).click();
  await page.getByRole("button", { name: "水平翻转", exact: true }).click();
  await page.getByRole("button", { name: "显示骨骼", exact: true }).click();
  await page.getByRole("button", { name: "收藏资源", exact: true }).click();
  await page
    .getByRole("button", { name: "新建分组", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("测试角色");
  await page.getByRole("button", { name: "创建分组", exact: true }).click();
  await page.getByRole("button", { name: "资源信息", exact: true }).click();
  const grouping = await page.evaluate(() => window.shelf.getLibrary());
  await page.getByLabel("所属分组").selectOption(grouping.collections[0].id);
  await page.getByLabel("资源标签").fill("测试，英雄");
  await page.getByLabel("资源备注").click();
  await page.getByLabel("资源备注").fill("重启后应保留");
  await page.getByRole("button", { name: "动画预览", exact: true }).click();
  await page.getByRole("button", { name: /全部资源/ }).click();
  await page.getByLabel("搜索资源").fill("英雄");
  await page.waitForFunction(
    () => document.querySelectorAll(".asset-card").length === 1,
  );
  assert.equal(
    await page.locator(".asset-card h3").textContent(),
    "spineboy-pro",
  );
  await page.getByLabel("搜索资源").fill("");
  await page.getByRole("button", { name: "列表视图" }).click();
  assert.equal(await page.locator(".list-view .asset-card").count(), 4);
  await page.getByRole("button", { name: "网格视图" }).click();
  const report = await page.evaluate(
    (paths) => window.shelf.importPaths(paths),
    [path.resolve("resources/examples")],
  );
  assert.equal(report.duplicates.length, 4);
  assert.equal(report.added.length, 0);
  await app.close();
  page = await launch();
  data = await page.evaluate(() => window.shelf.getLibrary());
  const persisted = data.assets.find((a) => a.name === "spineboy-pro");
  assert.equal(persisted.favorite, true);
  assert.equal(persisted.note, "重启后应保留");
  assert.deepEqual(persisted.tags, ["测试", "英雄"]);
  assert.equal(persisted.collectionId, data.collections[0].id);
  await page
    .getByRole("button", { name: "预览 spineboy-pro", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".ready-dot")?.textContent === "已就绪",
  );
  await page.screenshot({ path: "test-results/desktop.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: rendering, playback, timeline, grouping, favorites, tags, search, views, deduplication and restart persistence",
  );
} finally {
  if (app) await app.close().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
