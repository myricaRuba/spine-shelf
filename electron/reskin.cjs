const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PNG } = require('pngjs');
const { atlasPages } = require('./library.cjs');
const { ReskinProgress, visibleText } = require('./reskin-progress.cjs');

const ACTIVE = new Set(['queued', 'processing', 'applying']);
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function atomicJSON(file, data) {
  await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2));
  await fs.rename(file + '.tmp', file);
}
async function safeFile(root, relative) {
  check(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.includes('\\'), '文件路径无效。');
  const base = await fs.realpath(root);
  const file = await fs.realpath(path.resolve(base, relative));
  check(file.startsWith(base + path.sep), '文件必须在当前换肤任务目录内。');
  check((await fs.stat(file)).isFile(), '需要普通文件。');
  return file;
}
async function png(file) {
  const info = await fs.stat(file);
  check(info.size <= 64 * 1024 * 1024, '单张贴图不能超过 64 MB。');
  const bytes = await fs.readFile(file);
  check(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), '换肤贴图必须是有效 PNG。');
  check(bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 32000000, '贴图尺寸过大。');
  const image = PNG.sync.read(bytes);
  return { bytes, image };
}
class ReskinService {
  constructor(library, changed = () => {}) {
    this.library = library;
    this.changed = changed;
    this.root = path.join(library.root, 'ReskinJobs');
    this.index = path.join(this.root, 'jobs.json');
    this.jobs = [];
    this.progress = new ReskinProgress(this);
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    try { this.jobs = JSON.parse(await fs.readFile(this.index, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    check(Array.isArray(this.jobs), '换肤任务记录损坏，请保留备份。');
    for (const job of this.jobs.filter(j => j.status === 'applying')) {
      const committed = this.library.data.assets.find(a => a.id === job.assetId)?.reskins?.some(s => s.taskId === job.id);
      job.status = committed ? 'completed' : 'failed';
      job.message = committed ? '新皮肤已添加' : '上次写入中断，原素材未更改，可以重试。';
    }
    await this.save();
  }
  async save() { await atomicJSON(this.index, this.jobs); }
  task(id) { const job = this.jobs.find(j => j.id === id); check(job, '换肤任务不存在。'); return job; }
  dir(job) { return path.join(this.root, job.id); }
  list({ assetId, status } = {}) {
    return this.jobs.filter(j => (!assetId || j.assetId === assetId) && (!status || j.status === status)).slice().reverse();
  }
  async digest(asset) {
    const hash = createHash('sha256');
    const base = path.join(this.library.root, 'assets', asset.id);
    const files = [`skeleton.${asset.format}`, 'texture.atlas'];
    for (const layer of asset.reskins || []) files.push(layer.atlas);
    for (const atlas of files.filter(f => f.endsWith('.atlas'))) {
      const data = await fs.readFile(await safeFile(base, atlas), 'utf8');
      for (const p of atlasPages(data).pages) files.push(path.posix.join(path.posix.dirname(atlas), p.name));
    }
    for (const file of [...new Set(files)].sort()) hash.update(file).update(await fs.readFile(await safeFile(base, file)));
    return hash.update(JSON.stringify(asset.reskins || [])).update(String(asset.pma)).digest('hex');
  }
  async create({ assetId, name, prompt, baseSkin }) {
    const asset = this.library.asset(assetId);
    check(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60, '请填写 1–60 字的皮肤名称。');
    check(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000, '请填写换肤要求（最多 4000 字）。');
    name = name.trim();
    check(!asset.skins.includes(name), '这个皮肤名称已经存在，请换一个名称。');
    check(asset.skins.includes(baseSkin), '请选择当前资源已有的基础皮肤。');
    check(!this.jobs.some(j => j.assetId === assetId && ACTIVE.has(j.status)), '这个角色已有进行中的换肤任务，请先完成或取消。');
    const job = { id: randomUUID(), assetId, assetName: asset.name, name, prompt: prompt.trim(), baseSkin,
      status: 'queued', message: '等待 Codex 处理', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceDigest: await this.digest(asset), sourceRevision: asset.contentRevision || 0, version: asset.version, format: asset.format, pma: asset.pma };
    const dir = this.dir(job), base = path.join(this.library.root, 'assets', assetId);
    await fs.mkdir(path.join(dir, 'source'), { recursive: true });
    await fs.mkdir(path.join(dir, 'result'), { recursive: true });
    try {
      const layer = asset.reskins?.find(s => s.name === baseSkin);
      const atlasFile = layer?.atlas || 'texture.atlas';
      const atlas = await fs.readFile(await safeFile(base, atlasFile), 'utf8');
      const { lines, pages } = atlasPages(atlas);
      check(pages.length > 0 && pages.length <= 32, '图集页数无效。');
      job.pageHashes = [];
      for (let i = 0; i < pages.length; i++) {
        const source = await safeFile(base, path.posix.join(path.posix.dirname(atlasFile), pages[i].name));
        check(path.extname(source).toLowerCase() === '.png', '换肤目前需要 PNG 贴图。');
        const filename = `page-${i}.png`;
        await fs.copyFile(source, path.join(dir, 'source', filename));
        await fs.copyFile(source, path.join(dir, 'result', filename));
        job.pageHashes.push(createHash('sha256').update(await fs.readFile(source)).digest('hex'));
        lines[pages[i].line] = filename;
      }
      const normalized = lines.join('\n');
      job.atlasHash = createHash('sha256').update(normalized).digest('hex');
      await fs.writeFile(path.join(dir, 'source/texture.atlas'), normalized);
      await fs.writeFile(path.join(dir, 'result/texture.atlas'), normalized);
      await fs.copyFile(await safeFile(base, `skeleton.${asset.format}`), path.join(dir, 'source', `skeleton.${asset.format}`));
      await atomicJSON(path.join(dir, 'source/asset.json'), { ...asset, snapshotBaseSkin: baseSkin });
      job.pages = pages.length;
      this.jobs.push(job); await this.save(); this.changed(false);
      await this.progress.record(job,{kind:'status',status:'info',text:'任务已创建，等待开始'});
      return { job, handoff: this.handoff(job.id) };
    } catch (e) {
      this.jobs = this.jobs.filter(j => j.id !== job.id);
      await fs.rm(dir, { recursive: true, force: true }); throw e;
    }
  }
  handoff(id) {
    const j = this.task(id);
    return `请通过 spine-shelf MCP 处理换肤任务 ${j.id}。先调用 spine_reskin_get_task 获取任务和本地素材，再按 spine-reskin 技能完成。\n角色：${j.assetName}\n基础皮肤：${j.baseSkin}\n新皮肤：${j.name}\n要求：${j.prompt}\n只在该任务的 result 目录修改 PNG，保留图集布局、尺寸、旋转、透明度约定；不要修改骨骼或复制资源条目。完成后调用 spine_reskin_apply 写回同一 Spine，并验证皮肤切换。`;
  }
  async context(id) {
    const job = this.task(id), asset = this.library.asset(job.assetId), dir = this.dir(job);
    return { job, asset: { id: asset.id, name: asset.name, version: asset.version, format: asset.format, skins: asset.skins, animations: asset.animations, pma: asset.pma },
      sourceDir: path.join(dir, 'source'), resultDir: path.join(dir, 'result'),
      skeletonPath: path.join(dir, 'source', `skeleton.${job.format}`), atlasPath: path.join(dir, 'source/texture.atlas'),
      pages: Array.from({ length: job.pages }, (_, i) => ({ source: path.join(dir, 'source', `page-${i}.png`), result: path.join(dir, 'result', `page-${i}.png`) })),
      instructions: '使用 imagegen 重绘指定部件，然后准确回填 result 内 PNG 的原区域；所有未修改部件保留。图集、骨骼与附件绑定不需修改。PMA 按任务 pma 字段处理，超分后回到原逻辑像素尺寸。不要直接写资源库，完成后调用 spine_reskin_apply；软件将创建原生 Skin/linked mesh 并在同一资源内切换。' };
  }
  async update(id, status, message = '', recordProgress = true) {
    const j = this.task(id);
    check(['queued', 'processing', 'failed', 'cancelled'].includes(status), '任务状态无效。');
    check(!['completed', 'applying', 'cancelled'].includes(j.status), '这个任务已结束或正在写入。');
    if (ACTIVE.has(status)) check(!this.jobs.some(x => x.id !== id && x.assetId === j.assetId && ACTIVE.has(x.status)), '角色已有其他进行中的任务。');
    check(typeof message === 'string' && message.length <= 1000, '进度说明过长。');
    const previous = `${j.status}:${j.message}`;
    j.status = status; j.message = visibleText(message || ({ queued: '等待 Codex 处理', processing: 'Codex 正在制作', failed: '制作失败，可以重试', cancelled: '已取消' }[status]),1000);
    j.updatedAt = new Date().toISOString(); await this.save();
    if (recordProgress && previous !== `${j.status}:${j.message}`)
      await this.progress.record(j,{kind:status==='failed'?'error':'status',status:status==='failed'?'failed':'info',text:j.message});
    this.changed(false); return j;
  }
  async image(id, area, file) {
    const j = this.task(id); check(['source', 'result'].includes(area), '图片目录无效。');
    const data = await png(await safeFile(path.join(this.dir(j), area), file));
    check(data.bytes.length <= 12 * 1024 * 1024, '图片过大，请使用任务中的本地图片路径查看。');
    return { type: 'image', mimeType: 'image/png', data: data.bytes.toString('base64') };
  }
  async apply(id) {
    const job = this.task(id);
    if (job.status === 'completed') return { job, asset: this.library.asset(job.assetId) };
    check(['queued', 'processing'].includes(job.status), '请先开始或重试这个任务。');
    const asset = this.library.asset(job.assetId);
    check(!asset.skins.includes(job.name), '皮肤名称已存在。');
    check(await this.digest(asset) === job.sourceDigest, '角色在制作期间已更改，请取消并重新创建任务。');
    const dir = this.dir(job);
    const sourceAtlas = await fs.readFile(await safeFile(path.join(dir, 'source'), 'texture.atlas'), 'utf8');
    const atlas = await fs.readFile(await safeFile(path.join(dir, 'result'), 'texture.atlas'), 'utf8');
    check(createHash('sha256').update(sourceAtlas).digest('hex') === job.atlasHash, '原始图集快照已被修改，请重新创建任务。');
    check(atlas === sourceAtlas, '图集布局已改变。请恢复 texture.atlas，仅修改对应 PNG 图块。');
    let changed = false, bytes = Buffer.byteLength(atlas);
    const images = [];
    for (let i = 0; i < job.pages; i++) {
      const filename = `page-${i}.png`;
      const old = await png(await safeFile(path.join(dir, 'source'), filename));
      check(createHash('sha256').update(old.bytes).digest('hex') === job.pageHashes[i], '原始贴图快照已被修改，请重新创建任务。');
      const result = await png(await safeFile(path.join(dir, 'result'), filename));
      check(old.image.width === result.image.width && old.image.height === result.image.height, `贴图 ${filename} 尺寸与原图不一致。`);
      changed ||= !old.image.data.equals(result.image.data);
      bytes += result.bytes.length;
      check(bytes <= 256 * 1024 * 1024, '换肤结果总大小超过 256 MB。');
      images.push({ filename, bytes: result.bytes });
    }
    check(changed, '没有检测到贴图变化，请先完成重绘。');
    const base = path.join(this.library.root, 'assets', asset.id);
    const target = path.join(base, 'reskins', job.id), staging = target + '.tmp';
    const previous = structuredClone(asset);
    const layers = [...(asset.reskins || []), { name: job.name, baseSkin: job.baseSkin, atlas: `reskins/${job.id}/texture.atlas`, taskId: job.id }];
    await atomicJSON(path.join(dir, 'asset-before.json'), previous);
    job.status = 'applying'; job.message = '正在保存并添加新皮肤'; job.updatedAt = new Date().toISOString(); await this.save();
    await this.progress.record(job,{kind:'status',status:'info',text:job.message});
    try {
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      await fs.writeFile(path.join(staging, 'texture.atlas'), atlas);
      for (const img of images) await fs.writeFile(path.join(staging, img.filename), img.bytes);
      await fs.rm(target, { recursive: true, force: true }); // An interrupted, uncommitted attempt for this task only.
      await fs.rename(staging, target);
      await atomicJSON(path.join(base, 'reskins.json'), { version: 1, skins: layers });
      Object.assign(asset, { reskins: layers, skins: [...asset.skins, job.name], contentRevision: (asset.contentRevision || 0) + 1,
        thumbnail: false, size: asset.size + bytes });
      await this.library.save();
    } catch (e) {
      for (const k of Object.keys(asset)) delete asset[k]; Object.assign(asset, previous);
      await atomicJSON(path.join(base, 'reskins.json'), { version: 1, skins: previous.reskins || [] });
      await fs.rm(target, { recursive: true, force: true });
      job.status = 'failed'; job.message = '写入失败，原素材已保留：' + visibleText(e.message,800); job.updatedAt = new Date().toISOString(); await this.save();
      await this.progress.record(job,{kind:'error',status:'failed',text:job.message}); throw e;
    }
    job.status = 'completed'; job.message = '新皮肤已添加'; job.updatedAt = new Date().toISOString();
    await this.save(); this.changed(true);
    await this.progress.record(job,{kind:'status',status:'completed',text:job.message});
    return { job, asset, message: '新皮肤已添加到同一 Spine，可直接在皮肤下拉框切换。' };
  }
}
module.exports = { ReskinService, safeFile };
