const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function writeJSON(file, value) {
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await fs.rename(file + '.tmp', file);
}

// Only generated skin directories are eligible. Never move a native atlas or
// follow a directory junction out of the asset's generated-skin directory.
async function layerDirectory(library, assetId, layer) {
  if (!/^reskins\/[0-9a-f-]{36}\/texture\.atlas$/i.test(layer.atlas)) throw new Error('新增皮肤目录无效，未改动文件。');
  const base = await fs.realpath(path.join(library.root, 'assets', assetId));
  const directory = path.join(base, path.posix.dirname(layer.atlas));
  const real = await fs.realpath(directory);
  if (real !== directory || !real.startsWith(base + path.sep)) throw new Error('皮肤目录指向外部位置，未改动文件。');
  return directory;
}

async function beginSkinChange(library, asset, layer, operation) {
  const source = await layerDirectory(library, asset.id, layer);
  let bytes = 0;
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error('皮肤目录包含非普通文件，未改动文件。');
    bytes += (await fs.stat(path.join(source, entry.name))).size;
  }
  const directory = path.join(library.root, '.trash', 'skins', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const change = { assetId: asset.id, layer, operation, bytes, createdAt: new Date().toISOString(),
    assetBefore: structuredClone(asset), projectsBefore: structuredClone(library.data.projects), state: 'pending' };
  await writeJSON(path.join(directory, 'change.json'), change);
  return { directory, change };
}

async function finishSkinChange(library, record) {
  const { directory, change } = record;
  const asset = library.data.assets.find(a => a.id === change.assetId);
  // library.json is the commit point. An interrupted write keeps the old skin;
  // a completed write archives its files. Retrying is idempotent.
  if (!asset) return;
  const committed = !(asset.reskins || []).some(s => s.taskId === change.layer.taskId);
  await writeJSON(path.join(library.root, 'assets', asset.id, 'reskins.json'), { version: 1, skins: asset.reskins || [] });
  if (committed) {
    const destination = path.join(directory, 'files');
    try { await fs.access(destination); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const source = await layerDirectory(library, asset.id, change.layer);
      await fs.rename(source, destination);
    }
  }
  change.state = committed ? 'archived' : 'aborted';
  await writeJSON(path.join(directory, 'change.json'), change);
}

async function recoverSkinChanges(library) {
  const root = path.join(library.root, '.trash', 'skins');
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    try {
      const change = JSON.parse(await fs.readFile(path.join(directory, 'change.json'), 'utf8'));
      if (change.state === 'pending') await finishSkinChange(library, { directory, change });
    } catch { /* Leave the journal and files intact for the next startup. */ }
  }
}

module.exports = { beginSkinChange, finishSkinChange, recoverSkinChanges };
