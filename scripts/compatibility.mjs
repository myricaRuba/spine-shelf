import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const versions = ["3.8", "4.0", "4.1", "4.2", "4.3"];
const root = path.resolve("test-results/fixtures");
for (const version of versions) {
  await mkdir(path.join(root, version), { recursive: true });
  for (const file of [
    "spineboy-pro.json",
    "spineboy-pro.skel",
    "spineboy.atlas",
    "spineboy.png",
  ]) {
    const dest = path.join(root, version, file);
    try {
      await access(dest);
    } catch {
      const response = await fetch(
        `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${version}/examples/spineboy/export/${file}`,
      );
      if (!response.ok)
        throw new Error(`Fixture download failed: ${version}/${file}`);
      await writeFile(dest, Buffer.from(await response.arrayBuffer()));
    }
  }
}
const dataDir = await mkdtemp(path.join(tmpdir(), "spine-shelf-compat-"));
const env = {
  ...process.env,
  SPINE_SHELF_DATA: dataDir,
  SPINE_SHELF_TEST: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  await page.waitForSelector(".asset-card");
  const result = await page.evaluate(
    (paths) => window.shelf.importPaths(paths),
    [root],
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.added.length, 9);
  assert.equal(result.duplicates.length, 1);
  const testAssets = result.library.assets.filter(
    (a) => a.name === "spineboy-pro",
  );
  for (const asset of testAssets)
    await page.evaluate(
      (a) =>
        window.shelf.update(a.id, { name: `compat-${a.runtime}-${a.format}` }),
      asset,
    );
  await page.reload();
  await page.waitForSelector(".asset-card");
  for (const asset of testAssets) {
    const name = `compat-${asset.runtime}-${asset.format}`;
    await page
      .getByRole("button", { name: `预览 ${name}`, exact: true })
      .click();
    await page.waitForFunction(
      () =>
        ["已就绪", "加载失败"].includes(
          document.querySelector(".ready-dot")?.textContent,
        ),
      null,
      { timeout: 30000 },
    );
    const err = await page.locator(".stage-message.error").count();
    if (err)
      throw new Error(
        `${name}: ${await page.locator(".stage-message.error").innerText()}`,
      );
    const painted = await page
      .locator(".stage canvas")
      .evaluate(async (canvas) => {
        const img = new Image();
        img.src = canvas.toDataURL();
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
        let count = 0;
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 30) count++;
        return count;
      });
    assert.ok(painted > 1000, `${name}: empty canvas`);
    console.log("COMPAT PASS", name, asset.version, painted + " pixels");
  }
  console.log("PASS: all 10 runtime / format combinations rendered");
} finally {
  if (app) await app.close().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
