const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  Library,
  detectVersion,
  atlasPages,
} = require("../electron/library.cjs");
const sample = path.resolve("resources/examples/spineboy");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spine-shelf-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = new Library(path.join(root, "library"));
  await library.init();
  return { root, library };
}
test("recursive folder import persists independent copies, metadata, grouping and deduplication", async (t) => {
  const { root, library } = await setup(t);
  const source = path.join(root, "incoming", "nested", "character");
  await fs.cp(sample, source, { recursive: true });
  const result = await library.importPaths([path.join(root, "incoming")]);
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.errors, []);
  const id = result.added[0],
    asset = library.asset(id);
  assert.equal(asset.runtime, "4.2");
  assert.ok(asset.animations.includes("walk"));
  const duplicate = await library.importPaths([source]);
  assert.equal(duplicate.added.length, 0);
  assert.equal(duplicate.duplicates.length, 1);
  const grouped = await library.collection("create", undefined, "角色");
  await library.update(id, {
    favorite: true,
    collectionId: grouped.collections[0].id,
    tags: ["英雄"],
    note: "test note",
  });
  await fs.rm(path.join(root, "incoming"), { recursive: true });
  const restarted = new Library(library.root);
  await restarted.init();
  assert.equal(restarted.asset(id).favorite, true);
  assert.equal(restarted.asset(id).note, "test note");
  assert.deepEqual(restarted.asset(id).tags, ["英雄"]);
  assert.ok(
    await fs.stat(path.join(library.root, "assets", id, "textures", "0.png")),
  );
  assert.match(
    await fs.readFile(
      path.join(library.root, "assets", id, "texture.atlas"),
      "utf8",
    ),
    /textures\/0.png/,
  );
  await restarted.collection("remove", grouped.collections[0].id);
  assert.equal(restarted.asset(id).collectionId, null);
  await restarted.remove(id);
  assert.equal(restarted.data.assets.length, 0);
  assert.ok(
    await fs.stat(path.join(library.root, ".trash", id, "skeleton.json")),
  );
});
test("missing textures, .spine projects, unsupported versions and ambiguous atlases report actionable failures", async (t) => {
  const { root, library } = await setup(t);
  const source = path.join(root, "source");
  await fs.cp(sample, source, { recursive: true });
  await fs.rm(path.join(source, "spineboy.png"));
  let result = await library.importPaths([source]);
  assert.equal(result.added.length, 0);
  assert.match(result.errors[0].message, /缺少贴图/);
  await fs.writeFile(path.join(source, "project.spine"), "project");
  result = await library.importPaths([path.join(source, "project.spine")]);
  assert.match(result.errors[0].message, /工程文件/);
  const jsonFile = path.join(source, "spineboy-pro.json");
  const json = JSON.parse(await fs.readFile(jsonFile, "utf8"));
  json.skeleton.spine = "3.7.94";
  await fs.writeFile(jsonFile, JSON.stringify(json));
  result = await library.importPaths([source]);
  assert.ok(result.errors.some((e) => /3.7.94/.test(e.message)));
});
test("file selection imports only selected skeleton and ignores unrelated JSON", async (t) => {
  const { root, library } = await setup(t);
  const source = path.join(root, "source");
  await fs.cp(sample, source, { recursive: true });
  await fs.writeFile(path.join(source, "config.json"), '{"name":"settings"}');
  const result = await library.importPaths([
    path.join(source, "spineboy-pro.json"),
  ]);
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.errors, []);
  const config = await library.importPaths([path.join(source, "config.json")]);
  assert.equal(config.added.length, 0);
});
test("multiple texture pages and nested page names are parsed without confusing regions", () => {
  const text =
    "\ntex/page-1.png\nsize: 10, 10\nfilter: Linear, Linear\nhead\n  rotate: false\n  xy: 1, 1\n\ntex/page-2.png\nsize: 10, 10\nbody\n  rotate: false\n";
  assert.deepEqual(
    atlasPages(text).pages.map((p) => p.name),
    ["tex/page-1.png", "tex/page-2.png"],
  );
});
test("corrupt index never silently resets a user library", async (t) => {
  const { library } = await setup(t);
  await fs.writeFile(library.indexPath, "{bad");
  await assert.rejects(new Library(library.root).init());
  assert.equal(await fs.readFile(library.indexPath, "utf8"), "{bad");
});
test("binary header detection supports 3.8 and 4.x encodings", () => {
  const string = (str) =>
    Buffer.concat([Buffer.from([str.length + 1]), Buffer.from(str)]);
  assert.equal(
    detectVersion(Buffer.concat([Buffer.alloc(8), string("4.2.22")]), null),
    "4.2.22",
  );
  assert.equal(
    detectVersion(Buffer.concat([string("a1b2c3"), string("3.8.99")]), null),
    "3.8.99",
  );
  assert.equal(detectVersion(Buffer.from("garbage"), null), "");
});

test("classification persists and manual corrections survive metadata refreshes and batch classification", async (t) => {
  const { library } = await setup(t);
  const result = await library.importPaths([sample]);
  const id = result.added[0];
  assert.equal(library.asset(id).category, "character");
  assert.equal(library.asset(id).categorySource, "auto");
  await library.update(id, { category: "material" });
  await library.update(id, {
    name: "new_hero",
    contentFeatures: {
      boneNames: ["head", "leg", "arm"],
      animationNames: ["walk"],
    },
  });
  const batch = await library.classifyLibrary();
  assert.equal(batch.skipped, 1);
  const reopened = new Library(library.root);
  await reopened.init();
  assert.equal(reopened.asset(id).category, "material");
  assert.equal(reopened.asset(id).categorySource, "manual");
  await reopened.classifyLibrary(id);
  assert.equal(reopened.asset(id).category, "character");
  assert.equal(reopened.asset(id).categorySource, "auto");
  await assert.rejects(
    reopened.update(id, { category: "invalid" }),
    /分类无效/,
  );
});

test("existing libraries migrate using copied files and preserve collections, tags, favorites and source files", async (t) => {
  const { root, library } = await setup(t);
  const source = path.join(root, "original");
  await fs.cp(sample, source, { recursive: true });
  const result = await library.importPaths([source]);
  const id = result.added[0];
  const grouped = await library.collection("create", undefined, "收藏项目");
  await library.update(id, {
    favorite: true,
    tags: ["常用"],
    note: "不应改变",
    collectionId: grouped.collections[0].id,
  });
  const asset = library.asset(id);
  for (const key of [
    "category",
    "categorySource",
    "categoryReasons",
    "categoryConfidence",
    "classificationVersion",
    "contentFeatures",
  ])
    delete asset[key];
  await library.save();
  await fs.rm(source, { recursive: true });
  const migrated = new Library(library.root);
  await migrated.init();
  const saved = migrated.asset(id);
  assert.equal(saved.category, "character");
  assert.equal(saved.favorite, true);
  assert.equal(saved.note, "不应改变");
  assert.deepEqual(saved.tags, ["常用"]);
  assert.equal(saved.collectionId, grouped.collections[0].id);
  await fs.rm(path.join(library.root, "assets", id, "texture.atlas"));
  const broken = await migrated.classifyLibrary();
  assert.equal(broken.errors.length, 1);
  assert.equal(broken.unclassified, 1);
  assert.equal(migrated.data.assets.length, 1);
});

test("older binary assets reuse decoded animation names when upgrading without cached bone names", async t => {
  const { library } = await setup(t);
  const asset = { id: "binary-fixture", name: "10020", format: "skel", animations: ["attack01", "move", "suffer", "death", "frozen"] };
  const folder = path.join(library.root, "assets", asset.id);
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "skeleton.skel"), Buffer.alloc(16));
  await fs.writeFile(path.join(folder, "texture.atlas"), "image.png\nsize: 32,32\npart1\n  bounds: 0,0,32,32\n");
  assert.equal(await library.classifyAsset(asset), null);
  assert.equal(asset.category, "character");
  assert.deepEqual(asset.contentFeatures.animationNames, asset.animations);
});
