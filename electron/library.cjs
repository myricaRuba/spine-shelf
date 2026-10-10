const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const {
  CLASSIFIER_VERSION,
  CATEGORIES,
  classify,
  sanitizeFeatures,
  featuresFromJSON,
  atlasRegionNames,
  binaryNames,
} = require("./classifier.cjs");

const SUPPORTED = ["3.8", "4.0", "4.1", "4.2", "4.3"];
const skeletonPattern = /\.(json|skel|skel\.bytes)$/i;
const atlasPattern = /\.atlas(\.txt)?$/i;
const cleanStem = (name) =>
  path
    .basename(name)
    .replace(/\.(json|skel|skel\.bytes|atlas|atlas\.txt)$/i, "")
    .replace(/[-_](pro|ess|pma)$/i, "")
    .toLowerCase();

function readString(buffer, start) {
  let value = 0,
    shift = 0,
    pos = start;
  while (pos < buffer.length && shift < 35) {
    const b = buffer[pos++];
    value |= (b & 127) << shift;
    if (!(b & 128)) break;
    shift += 7;
  }
  if (value < 1 || value > 200 || pos + value - 1 > buffer.length) return null;
  return {
    value: buffer.toString("utf8", pos, pos + value - 1),
    end: pos + value - 1,
  };
}
function detectVersion(buffer, json) {
  if (json)
    return typeof json.skeleton?.spine === "string" ? json.skeleton.spine : "";
  // 4.x stores an 8-byte hash; 3.8 stores a length-prefixed hash string.
  const modern = readString(buffer, 8);
  if (modern && /^\d+\.\d+\.\d+/.test(modern.value)) return modern.value;
  const hash = readString(buffer, 0);
  const legacy = hash && readString(buffer, hash.end);
  return legacy && /^\d+\.\d+\.\d+/.test(legacy.value) ? legacy.value : "";
}
function atlasPages(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const pages = [];
  let expectPage = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      expectPage = true;
      continue;
    }
    if (expectPage) {
      if (!line.includes(":")) pages.push({ name: line, line: i });
      expectPage = false;
    }
  }
  return { lines, pages };
}
async function scan(root, files = new Set()) {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) return files;
  if (stat.isDirectory()) {
    for (const item of await fs.readdir(root, { withFileTypes: true })) {
      if (
        item.name.startsWith(".") ||
        ["node_modules", "__MACOSX"].includes(item.name)
      )
        continue;
      if (files.size > 25000)
        throw new Error("文件夹超过 25,000 个文件，请选择更具体的素材文件夹。");
      await scan(path.join(root, item.name), files);
    }
  } else if (stat.isFile()) files.add(path.resolve(root));
  return files;
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
class Library {
  constructor(root) {
    this.root = root;
    this.indexPath = path.join(root, "library.json");
    this.data = null;
  }
  async init() {
    await fs.mkdir(path.join(this.root, "assets"), { recursive: true });
    if (await exists(this.indexPath)) {
      this.data = JSON.parse(await fs.readFile(this.indexPath, "utf8"));
      if (
        this.data.version !== 1 ||
        !Array.isArray(this.data.assets) ||
        !Array.isArray(this.data.collections)
      )
        throw new Error("资源库索引无法读取，请保留 library.json 并恢复备份。");
    } else {
      this.data = { version: 1, assets: [], collections: [], seeded: false };
      await this.save();
    }
    let migrated = false;
    for (const asset of this.data.assets) {
      if (
        asset.classificationVersion === CLASSIFIER_VERSION ||
        asset.categorySource === "manual"
      )
        continue;
      await this.classifyAsset(asset);
      migrated = true;
    }
    if (migrated) await this.save();
    return this.snapshot();
  }
  snapshot() {
    return structuredClone({ ...this.data, root: this.root });
  }
  async save() {
    const temporary = this.indexPath + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(this.data, null, 2));
    if (await exists(this.indexPath))
      await fs.copyFile(this.indexPath, this.indexPath + ".bak");
    await fs.rename(temporary, this.indexPath);
  }
  asset(id) {
    const asset = this.data.assets.find((item) => item.id === id);
    if (!asset) throw new Error("资源不存在。");
    return asset;
  }
  async importPaths(inputs, options = {}) {
    if (
      !Array.isArray(inputs) ||
      inputs.length > 500 ||
      inputs.some((p) => typeof p !== "string" || !path.isAbsolute(p))
    )
      throw new Error("请选择有效的本地文件或文件夹。");
    const files = new Set(),
      selected = new Set(),
      folders = [];
    for (const input of inputs) {
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        folders.push(path.resolve(input));
        await scan(input, files);
      } else {
        selected.add(path.resolve(input));
        await scan(path.dirname(input), files);
      }
    }
    const all = [...files],
      atlases = all.filter((f) => atlasPattern.test(f));
    const included = (file) =>
      selected.has(file) ||
      folders.some((folder) => file.startsWith(folder + path.sep));
    const report = { added: [], duplicates: [], errors: [] };
    const candidates = all.filter(
      (f) => included(f) && skeletonPattern.test(f),
    );
    for (const project of all.filter(
      (f) => included(f) && /\.spine$/i.test(f),
    )) {
      report.errors.push({
        file: path.basename(project),
        message:
          "这是 Spine 工程文件。请在 Spine 中导出 JSON 或二进制数据，并一起导出 atlas 和贴图。",
      });
    }
    for (const source of candidates) {
      let assetDir;
      try {
        const raw = await fs.readFile(source);
        let json = null;
        const format =
          /\.json$/i.test(source) ||
          /^[\s\uFEFF]*\{/.test(raw.toString("utf8", 0, 32))
            ? "json"
            : "skel";
        if (format === "json") {
          json = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
          if (!Array.isArray(json.bones)) continue; // Ignore unrelated project/config JSON files.
        }
        const version = detectVersion(raw, json);
        const runtime = version.split(".").slice(0, 2).join(".");
        if (!SUPPORTED.includes(runtime))
          throw new Error(
            version
              ? `检测到 Spine ${version}，当前支持 ${SUPPORTED.join(" / ")}。请使用匹配版本重新导出。`
              : "无法识别 Spine 导出版本，请检查文件是否完整。",
          );
        const nearby = atlases.filter(
          (a) => path.dirname(a) === path.dirname(source),
        );
        const exact = nearby.filter((a) => cleanStem(a) === cleanStem(source));
        const straight = exact.filter((a) => !/[-_]pma\.atlas/i.test(a));
        let atlas =
          exact.length === 1
            ? exact[0]
            : straight.length === 1
              ? straight[0]
              : nearby.length === 1
                ? nearby[0]
                : null;
        if (!atlas) {
          const matching = atlases.filter(
            (a) => cleanStem(a) === cleanStem(source),
          );
          if (matching.length === 1) atlas = matching[0];
        }
        if (!atlas)
          throw new Error(
            nearby.length
              ? "发现多个图集，无法确定配对。请将骨骼与对应 atlas 命名为相同名称，或放入独立文件夹。"
              : "缺少对应的 .atlas 图集。请将骨骼、图集和图片放在同一文件夹。",
          );
        const atlasText = await fs.readFile(atlas, "utf8");
        const { lines, pages } = atlasPages(atlasText);
        if (!pages.length) throw new Error("图集没有有效贴图页。");
        const textures = [];
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          let texture = path.resolve(
            path.dirname(atlas),
            page.name.replace(/\\/g, "/"),
          );
          if (!files.has(texture)) {
            const matches = all.filter(
              (f) =>
                path.basename(f).toLowerCase() ===
                path.basename(page.name).toLowerCase(),
            );
            if (matches.length === 1) texture = matches[0];
            else throw new Error(`缺少贴图 ${page.name}，请一起导入。`);
          }
          const bytes = await fs.readFile(texture);
          const dest = `textures/${i}${path.extname(texture).toLowerCase()}`;
          textures.push({ source: texture, dest, bytes });
          lines[page.line] = dest;
        }
        const hash = createHash("sha256").update(raw).update(atlasText);
        for (const texture of textures) hash.update(texture.bytes);
        const fingerprint = hash.digest("hex");
        if (this.data.assets.some((a) => a.fingerprint === fingerprint)) {
          report.duplicates.push(path.basename(source));
          continue;
        }
        const id = randomUUID();
        assetDir = path.join(this.root, "assets", id);
        await fs.mkdir(path.join(assetDir, "textures"), { recursive: true });
        await fs.writeFile(path.join(assetDir, `skeleton.${format}`), raw);
        await fs.writeFile(
          path.join(assetDir, "texture.atlas"),
          lines.join("\n"),
        );
        for (const texture of textures)
          await fs.writeFile(path.join(assetDir, texture.dest), texture.bytes);
        const asset = {
          id,
          name: path
            .basename(source)
            .replace(/\.(json|skel|skel\.bytes)$/i, ""),
          version,
          runtime,
          format,
          fingerprint,
          source,
          importedAt: new Date().toISOString(),
          favorite: false,
          collectionId: options.collectionId || null,
          tags: [],
          note: "",
          demo: !!options.demo,
          size:
            raw.length +
            Buffer.byteLength(atlasText) +
            textures.reduce((n, t) => n + t.bytes.length, 0),
          animations: json ? Object.keys(json.animations || {}) : [],
          skins: json
            ? Array.isArray(json.skins)
              ? json.skins.map((s) => s.name)
              : Object.keys(json.skins || {})
            : [],
          bones: json?.bones?.length || 0,
          slots: json?.slots?.length || 0,
          pages: textures.length,
          pma:
            /pma:\s*true/.test(atlasText) ||
            /[-_]pma/i.test(path.basename(atlas)),
          thumbnail: false,
          contentFeatures: json ? featuresFromJSON(json) : sanitizeFeatures({}),
        };
        Object.assign(
          asset,
          classify({
            name: asset.name,
            features: asset.contentFeatures,
            regionNames: atlasRegionNames(atlasText),
            binaryHints: json ? [] : binaryNames(raw),
          }),
        );
        this.data.assets.push(asset);
        report.added.push(id);
      } catch (error) {
        if (assetDir) await fs.rm(assetDir, { recursive: true, force: true });
        report.errors.push({
          file: path.basename(source),
          message: error.message,
        });
      }
    }
    if (!candidates.length && !report.errors.length)
      report.errors.push({
        file: "所选文件夹",
        message: "没有找到 .json 或 .skel 骨骼文件。支持递归识别子文件夹。",
      });
    await this.save();
    return { ...report, library: this.snapshot() };
  }
  async update(id, patch) {
    const asset = this.asset(id);
    if (patch.contentRevision !== undefined && patch.contentRevision !== (asset.contentRevision || 0))
      throw new Error("资源已更新，请刷新后重试。");
    if (patch.category !== undefined && !CATEGORIES.includes(patch.category))
      throw new Error("内容分类无效。");
    if (typeof patch.name === "string" && patch.name.trim())
      asset.name = patch.name.trim().slice(0, 120);
    if (typeof patch.favorite === "boolean") asset.favorite = patch.favorite;
    if (typeof patch.pma === "boolean") asset.pma = patch.pma;
    if (typeof patch.note === "string") asset.note = patch.note.slice(0, 4000);
    if (Array.isArray(patch.tags))
      asset.tags = [
        ...new Set(
          patch.tags
            .filter((t) => typeof t === "string")
            .map((t) => t.trim().slice(0, 30))
            .filter(Boolean),
        ),
      ].slice(0, 20);
    if (
      patch.collectionId === null ||
      this.data.collections.some((c) => c.id === patch.collectionId)
    )
      asset.collectionId = patch.collectionId;
    if (Array.isArray(patch.animations))
      asset.animations = patch.animations.filter((a) => typeof a === "string");
    if (Array.isArray(patch.skins))
      asset.skins = patch.skins.filter((a) => typeof a === "string");
    for (const key of ["bones", "slots"])
      if (Number.isInteger(patch[key]) && patch[key] >= 0)
        asset[key] = patch[key];
    if (patch.contentFeatures && typeof patch.contentFeatures === "object")
      asset.contentFeatures = sanitizeFeatures(patch.contentFeatures);
    if (patch.category !== undefined) {
      Object.assign(asset, {
        category: patch.category,
        categorySource: "manual",
        categoryConfidence: "manual",
        categoryReasons: ["你手动设置的分类"],
        classificationVersion: CLASSIFIER_VERSION,
      });
    } else if (
      asset.categorySource !== "manual" &&
      (patch.contentFeatures || typeof patch.name === "string")
    ) {
      await this.classifyAsset(asset);
    }
    await this.save();
    return this.snapshot();
  }
  async classifyAsset(asset) {
    const base = path.join(this.root, "assets", asset.id);
    try {
      const raw = await fs.readFile(
        path.join(base, `skeleton.${asset.format}`),
      );
      const atlas = await fs.readFile(path.join(base, "texture.atlas"), "utf8");
      const features =
        asset.format === "json"
          ? featuresFromJSON(
              JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, "")),
            )
          : sanitizeFeatures({ ...asset.contentFeatures, animationNames: asset.contentFeatures?.animationNames?.length ? asset.contentFeatures.animationNames : asset.animations });
      asset.contentFeatures = features;
      Object.assign(
        asset,
        classify({
          name: asset.name,
          features,
          regionNames: atlasRegionNames(atlas),
          binaryHints: asset.format === "skel" ? binaryNames(raw) : [],
        }),
      );
      return null;
    } catch (error) {
      Object.assign(asset, classify());
      asset.categoryReasons = ["素材文件不完整，暂无法自动分类"];
      return { id: asset.id, name: asset.name, message: error.message };
    }
  }
  async classifyLibrary(id) {
    const targets = id === undefined ? this.data.assets : [this.asset(id)];
    const report = { classified: 0, unclassified: 0, skipped: 0, errors: [] };
    for (const asset of targets) {
      // Explicit single-asset reclassification restores automatic mode.
      if (id === undefined && asset.categorySource === "manual") {
        report.skipped++;
        continue;
      }
      const error = await this.classifyAsset(asset);
      if (error) report.errors.push(error);
      if (asset.category === "unclassified") report.unclassified++;
      else report.classified++;
    }
    await this.save();
    return { ...report, library: this.snapshot() };
  }
  async thumbnail(id, data, revision) {
    const asset = this.asset(id);
    if (revision !== undefined && revision !== (asset.contentRevision || 0))
      throw new Error("资源已更新，请重新生成缩略图。");
    if (
      typeof data !== "string" ||
      !data.startsWith("data:image/png;base64,") ||
      data.length > 8000000
    )
      throw new Error("缩略图无效。");
    await fs.writeFile(
      path.join(this.root, "assets", id, "thumbnail.png"),
      Buffer.from(data.split(",")[1], "base64"),
    );
    asset.thumbnail = true;
    await this.save();
    return this.snapshot();
  }
  async remove(id) {
    this.asset(id);
    this.data.assets = this.data.assets.filter((a) => a.id !== id);
    // Commit the index first; keep a recoverable copy of removed assets.
    await this.save();
    const trash = path.join(this.root, ".trash");
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(path.join(this.root, "assets", id), path.join(trash, id));
    return this.snapshot();
  }
  async collection(action, id, name) {
    if (action === "create") {
      if (typeof name !== "string" || !name.trim())
        throw new Error("请输入分组名称。");
      this.data.collections.push({
        id: randomUUID(),
        name: name.trim().slice(0, 50),
      });
    } else if (action === "remove") {
      this.data.collections = this.data.collections.filter((c) => c.id !== id);
      this.data.assets.forEach((a) => {
        if (a.collectionId === id) a.collectionId = null;
      });
    } else if (action === "rename") {
      const collection = this.data.collections.find((c) => c.id === id);
      if (!collection || typeof name !== "string" || !name.trim())
        throw new Error("分组名称无效。");
      collection.name = name.trim().slice(0, 50);
    } else throw new Error("未知操作。");
    await this.save();
    return this.snapshot();
  }
}
module.exports = { Library, detectVersion, atlasPages, SUPPORTED };
