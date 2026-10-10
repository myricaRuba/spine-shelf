import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = await mkdtemp(path.join(tmpdir(), "spine-classify-e2e-"));
const source = path.join(root, "source");
for (const [name, regions] of [
  ["0001", ["sky", "mountain", "ground"]],
  ["0002", ["panel_border", "title_text", "button_confirm"]],
  ["0003", ["a0", "b0"]],
]) {
  const dir = path.join(source, name);
  await mkdir(dir, { recursive: true });
  await copyFile(
    "resources/examples/spineboy/spineboy.png",
    path.join(dir, "image.png"),
  );
  const attachments = Object.fromEntries(
    regions.map((region) => [region, { [region]: { width: 32, height: 32 } }]),
  );
  await writeFile(
    path.join(dir, `${name}.json`),
    JSON.stringify({
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }],
      slots: regions.map((region) => ({
        name: region,
        bone: "root",
        attachment: region,
      })),
      skins: [{ name: "default", attachments }],
      animations: { animation: {} },
    }),
  );
  await writeFile(
    path.join(dir, `${name}.atlas`),
    "image.png\nsize: 1024,1024\nfilter: Linear,Linear\n" +
      regions.map((region) => `${region}\n  bounds: 0,0,32,32\n`).join(""),
  );
}
const env = {
  ...process.env,
  SPINE_SHELF_DATA: path.join(root, "data"),
  SPINE_SHELF_TEST: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".asset-card");
  return page;
}
try {
  let page = await launch();
  const report = await page.evaluate(
    (paths) => window.shelf.importPaths(paths),
    [source],
  );
  assert.equal(report.added.length, 3);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.library.assets
      .filter((a) => /^000/.test(a.name))
      .map((a) => a.category),
    ["scene", "material", "unclassified"],
  );
  await page.reload();
  await page.waitForSelector(".asset-card");
  for (const [label, count] of [
    ["人物", 4],
    ["场景", 1],
    ["普通素材", 1],
    ["待分类", 1],
  ]) {
    await page
      .getByRole("button", { name: `分类：${label}`, exact: true })
      .click();
    assert.equal(await page.locator(".asset-card").count(), count);
  }
  await page
    .getByRole("button", { name: "分类：普通素材", exact: true })
    .click();
  await page.getByRole("button", { name: "预览 0002", exact: true }).click();
  await page.getByRole("button", { name: "资源信息", exact: true }).click();
  await page.getByLabel("内容分类", { exact: true }).selectOption("character");
  await page.waitForFunction(() =>
    document.querySelector(".restore-classification"),
  );
  await page.getByRole("button", { name: "重新自动分类", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="status"]')
      ?.textContent.includes("保留手动分类 1 份"),
  );
  await fsRemovedSource();
  await app.close();
  page = await launch();
  const persisted = await page.evaluate(() => window.shelf.getLibrary());
  assert.equal(
    persisted.assets.find((a) => a.name === "0002").category,
    "character",
  );
  assert.equal(
    persisted.assets.find((a) => a.name === "0002").categorySource,
    "manual",
  );
  await page.getByRole("button", { name: "预览 0002", exact: true }).click();
  await page.getByRole("button", { name: "资源信息", exact: true }).click();
  await page.getByRole("button", { name: "恢复自动分类", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="内容分类"]')?.value === "material",
  );
  await page
    .getByRole("button", { name: "分类：普通素材", exact: true })
    .click();
  assert.equal(await page.locator(".asset-card").count(), 1);
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: /全部资源/ }).click();
  await page
    .getByRole("button", { name: "预览 spineboy-pro", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".ready-dot")?.textContent === "已就绪",
  );
  await page.getByRole("button", { name: "资源信息", exact: true }).click();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classification.png" });
  console.log(
    "PASS: content classification for numbered assets, all four filters, manual protection, restart persistence, restore-auto and removed source folders",
  );
} finally {
  if (app) await app.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
async function fsRemovedSource() {
  await rm(source, { recursive: true, force: true });
}
