const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../electron/library.cjs');
const vm = require('node:vm');
const { decodeSkeleton36 } = require('../electron/spine36-binary.cjs');
const { mergeSkinJSON } = require('../electron/spine-skin-export.cjs');

const fixtures = path.join(__dirname, 'fixtures/spine36');
test('imports a 3.6 binary directly, retains original bytes, and prepares its preview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spine36-import-'));
  try {
    const source = path.join(root, 'source');
    await fs.cp(fixtures, source, {recursive: true});
    // Importing only inspects texture bytes; rendering uses the official PNG in test:compat.
    await fs.writeFile(path.join(source, 'spineboy.png'), Buffer.from('texture fixture'));
    const library = new Library(path.join(root, 'library'));
    await library.init();
    const report = await library.importPaths([path.join(source, 'spineboy-pro.skel')]);
    assert.deepEqual(report.errors, []);
    assert.equal(report.added.length, 1);
    const asset = library.asset(report.added[0]);
    assert.equal(asset.runtime, '3.6');
    assert.equal(asset.format, 'skel');
    const dir = path.join(library.root, 'assets', asset.id);
    assert.deepEqual(await fs.readFile(path.join(dir, 'skeleton.skel')), await fs.readFile(path.join(source, 'spineboy-pro.skel')));
    const preview = JSON.parse(await fs.readFile(path.join(dir, 'preview.json'), 'utf8'));
    assert.equal(preview.skeleton.spine, asset.version);
    assert.ok(asset.animations.includes('walk'));
    assert.ok(asset.bones > 0);
    assert.equal((await library.importPaths([path.join(source, 'spineboy-pro.skel')])).duplicates.length, 1);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

async function runtime() {
  const context = vm.createContext({console});
  const legacy = {sentinel: true}; context.spine = legacy;
  vm.runInContext(await fs.readFile(path.join(__dirname, '../public/vendor/spine36.js'), 'utf8'), context);
  assert.equal(context.spine, legacy, '3.6 must not replace the 3.8 namespace');
  return context.spine36;
}

test('3.6 SKEL matches official JSON animations, geometry, colors and draw order', async () => {
  const rt = await runtime();
  const atlas = new rt.TextureAtlas(await fs.readFile(path.join(fixtures, 'spineboy.atlas'), 'utf8'),
    () => new rt.FakeTexture({width:1024, height:1024}));
  const reference = JSON.parse(await fs.readFile(path.join(fixtures, 'spineboy-pro.json'), 'utf8'));
  const decoded = decodeSkeleton36(await fs.readFile(path.join(fixtures, 'spineboy-pro.skel')));
  const load = json => new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
  const datas = [load(reference), load(decoded)];
  assert.deepEqual(Array.from(datas[1].animations, a => a.name), Array.from(datas[0].animations, a => a.name));
  assert.equal(datas[1].version, datas[0].version);
  assert.equal(datas[1].bones.length, datas[0].bones.length);
  const close = (a,b,tolerance,label) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < tolerance, `${label}: ${a} vs ${b}`);
  for (const animation of datas[0].animations) {
    const actual = datas[1].findAnimation(animation.name);
    close(actual.duration, animation.duration, 0.0001, `${animation.name} duration`);
    assert.equal(actual.timelines.length, animation.timelines.length);
    for (const ratio of [0, .13, .37, .61, .93]) {
      const [expected, actual] = datas.map(data => {
        const s = new rt.Skeleton(data), state = new rt.AnimationState(new rt.AnimationStateData(data));
        state.setAnimation(0, animation.name, false); state.update(animation.duration * ratio); state.apply(s); s.updateWorldTransform();
        return s;
      });
      // The paired upstream JSON rounds times and Bezier controls; the SKEL
      // retains full precision. Resulting large-rig world coordinates differ
      // by up to 1.4 units at these samples (under 0.2% of its height).
      for (let i=0; i<expected.bones.length; i++) for (const key of ['worldX','worldY','a','b','c','d'])
        close(actual.bones[i][key], expected.bones[i][key], key.startsWith('world') ? 2 : .02, `${animation.name}/${ratio}/${expected.bones[i].data.name}/${key}`);
      assert.deepEqual(Array.from(actual.drawOrder, s=>s.data.name), Array.from(expected.drawOrder, s=>s.data.name));
      for (let i=0; i<expected.slots.length; i++) {
        const a=actual.slots[i], e=expected.slots[i];
        assert.equal(a.attachment?.name, e.attachment?.name);
        for (const key of ['r','g','b','a']) close(a.color[key], e.color[key], 1/255, `${animation.name}/${ratio}/slot color ${key}`);
        if (a.attachment instanceof rt.MeshAttachment) {
          const av=new Float32Array(a.attachment.worldVerticesLength), ev=new Float32Array(e.attachment.worldVerticesLength);
          assert.equal(av.length, ev.length);
          a.attachment.computeWorldVertices(a,0,av.length,av,0,2);e.attachment.computeWorldVertices(e,0,ev.length,ev,0,2);
          for (let n=0; n<av.length; n++) close(av[n],ev[n],2,`${animation.name}/${ratio}/${a.data.name}/vertex ${n}`);
        }
      }
    }
  }
});

test('malformed 3.6 binaries fail without generating a partial preview', async () => {
  const input = await fs.readFile(path.join(fixtures, 'spineboy-pro.skel'));
  for (const end of [0, 1, 8, 40, Math.floor(input.length/2), input.length-1])
    assert.throws(() => decodeSkeleton36(input.subarray(0,end)), /Spine 3.6 二进制数据无效/);
  assert.throws(() => decodeSkeleton36(Buffer.concat([input, Buffer.from([0])])), /文件尾/);
  assert.throws(() => decodeSkeleton36(Buffer.from([255,255,255,255,255])), /整数超出范围/);
  const wrongVersion=Buffer.from(input), index=input.indexOf(Buffer.from('3.6.32'));
  wrongVersion.write('3.8.99',index);
  assert.throws(() => decodeSkeleton36(wrongVersion), /需要 3.6/);
});

test('3.6 imports report a mismatched atlas before declaring success', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine36-atlas-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.cp(fixtures,source,{recursive:true});
  await fs.writeFile(path.join(source,'spineboy.png'),Buffer.from('texture fixture'));
  const skeleton=path.join(source,'spineboy-pro.skel');
  const library=new Library(path.join(root,'library'));await library.init();
  await fs.writeFile(path.join(source,'spineboy.atlas'),'spineboy.png\nsize: 1024,1024\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n');
  const result=await library.importPaths([skeleton]);
  assert.equal(result.added.length,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].message,/图集缺少图块/);
  assert.equal(library.data.assets.length,0);
});

test('exporting switchable 3.6 skins keeps the legacy JSON skin schema', async () => {
  const source=JSON.parse(await fs.readFile(path.join(fixtures,'spineboy-pro.json'),'utf8'));
  const result=mergeSkinJSON(source,[{name:'new-look',baseSkin:'default'}],['new/']);
  assert.equal(Array.isArray(result.skins),false);
  assert.deepEqual(Object.keys(result.skins),['default','new-look']);
  assert.equal(result.skeleton.spine,source.skeleton.spine);
  const rt=await runtime();
  const atlas=new rt.TextureAtlas(await fs.readFile(path.join(fixtures,'spineboy.atlas'),'utf8'),()=>new rt.FakeTexture({width:1024,height:1024}));
  const lookup=atlas.findRegion.bind(atlas); atlas.findRegion=name=>lookup(name.replace(/^new\//,''));
  const data=new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(result);
  assert.ok(data.findSkin('new-look'));
  assert.equal(data.animations.length,Object.keys(source.animations).length);
});
