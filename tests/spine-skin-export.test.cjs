const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {PNG}=require('pngjs');
const {prepareSkinExport,mergeSkinJSON,skinMode}=require('../electron/spine-skin-export.cjs');
const {loadSkeletonData,validateConvertedSkeleton}=require('../electron/spine-export-validation.cjs');

const atlas='page.png\nsize: 16,16\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n'+['body','alias','shared'].map(n=>`${n}\n  rotate: false\n  xy: 0,0\n  size: 16,16\n  orig: 16,16\n  offset: 0,0\n  index: -1\n`).join('');
function source(version) {
  const mesh={type:'mesh',uvs:[0,0,1,0,1,1,0,1],triangles:[0,1,2,2,3,0],vertices:[1,0,0,0,1,1,0,16,0,1,1,0,16,16,1,1,0,0,16,1],hull:4,width:16,height:16};
  const animation={slots:{body:{attachment:[{name:'body'},{time:.75,name:'alias'}]}}};
  const timeline=[{}, {time:1,vertices:[4,0,4,0,4,0,4,0]}];
  if(['3.8','4.0'].some(v=>version.startsWith(v)))animation.deform={default:{body:{body:timeline}},armored:{body:{body:timeline}}};
  else animation.attachments={default:{body:{body:{deform:timeline}}},armored:{body:{body:{deform:timeline}}}};
  const linked={type:'linkedmesh',path:'alias',skin:'default',[version.startsWith('4.3')?'source':'parent']:'body'};
  return {skeleton:{spine:version},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'},{name:'shared',bone:'root',attachment:'shared'}],
    skins:[{name:'default',attachments:{body:{body:mesh,alias:linked},shared:{shared:{width:16,height:16}}}},
      {name:'armored',attachments:{body:{body:{...structuredClone(mesh),color:'aaffffff'}}}}],animations:{move:animation}};
}
async function fixture(t,version='4.2.22') {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'spine-skin-export-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const layers=[{name:'野兽',baseSkin:'armored',atlas:'one/texture.atlas'},{name:'丧尸',baseSkin:'野兽',atlas:'two/texture.atlas'}];
  for(const [i,dir] of ['', 'one','two'].entries()) {
    await fs.mkdir(path.join(base,dir),{recursive:true});await fs.writeFile(path.join(base,dir,'texture.atlas'),atlas);
    const png=new PNG({width:16,height:16});png.data.fill(255);for(let n=0;n<png.data.length;n+=4)png.data[n]=i*80;
    await fs.writeFile(path.join(base,dir,'page.png'),PNG.sync.write(png));
  }
  const json=source(version),output={json,bytes:Buffer.from(JSON.stringify(json)),format:'json',version,runtime:version.split('.').slice(0,2).join('.'),converted:false};
  const asset={name:'fixture',skins:['default','armored','野兽','丧尸'],reskins:layers,bones:1,slots:2,animations:['move']};
  return {base,asset,output,selectedSkin:'丧尸',mode:'switchable'};
}
function sample(rt,data,runtime,skin,time) {
  const skeleton=new rt.Skeleton(data),modern=runtime==='4.3';
  if(modern){skeleton.setSkin(skin);skeleton.setupPose();}else{skeleton.setSkinByName(skin);skeleton.setToSetupPose();}
  const state=new rt.AnimationState(new rt.AnimationStateData(data));state.setAnimation(0,'move',false);state.update(time);state.apply(skeleton);skeleton.updateWorldTransform(rt.Physics?.reset);
  return skeleton.slots.map(slot=>{
    const a=modern?slot.appliedPose.attachment:slot.attachment;
    if(!(a instanceof rt.MeshAttachment))return {path:a?.path};
    const vertices=new Float32Array(a.worldVerticesLength);
    if(modern)a.computeWorldVertices(skeleton,slot,0,vertices.length,vertices,0,2);else a.computeWorldVertices(slot,0,vertices.length,vertices,0,2);
    return {path:a.path,vertices:[...vertices]};
  });
}
test('all supported runtimes switch native/AI skins with identical weighted mesh deformation and default fallback',async t=>{
  for(const version of ['3.8.75','3.8.99','4.0.31','4.1.19','4.2.22','4.3.13']) {
    const x=await fixture(t,version),before=JSON.stringify(x.output.json),built=await prepareSkinExport(x);
    assert.equal(JSON.stringify(x.output.json),before);assert.equal(built.output.version,version);
    assert.deepEqual(built.skins,x.asset.skins);assert.equal(built.runtimeSkin,'丧尸');assert.equal(built.bakedSkin,false);
    assert.equal(built.textures.length,3);assert.equal(new Set(built.textures.map(t=>t.name)).size,3);
    const {rt,data}=await loadSkeletonData(built.output,built.atlas);
    await validateConvertedSkeleton(built.output,built.atlas,x.asset,'丧尸',{allSkins:true});
    for(const time of [0,.25,.5,.9,1]) {
      const original=sample(rt,data,x.output.runtime,'armored',time);
      for(const skin of ['野兽','丧尸']) {
        const actual=sample(rt,data,x.output.runtime,skin,time);
        assert.deepEqual(actual[0].vertices,original[0].vertices,`${version} ${skin} t=${time}`);
        assert.match(actual[0].path,/^__shelf_skin_/);assert.match(actual[1].path,/^__shelf_skin_.*shared$/);
      }
    }
    assert.notDeepEqual(sample(rt,data,x.output.runtime,'丧尸',0)[0].vertices,sample(rt,data,x.output.runtime,'丧尸',.5)[0].vertices,'Deform must actually animate');
  }
});
test('single appearance remains available, but default export mode is switchable',async t=>{
  assert.equal(skinMode(),'switchable');assert.throws(()=>skinMode({skinMode:'unknown'}));
  const x=await fixture(t),built=await prepareSkinExport({...x,mode:'current'});
  assert.equal(built.bakedSkin,true);assert.equal(built.runtimeSkin,'armored');assert.equal(built.textures.length,1);assert.equal(built.output.bytes,x.output.bytes);
  assert.deepEqual(built.textures[0].bytes,await fs.readFile(path.join(x.base,'two/page.png')));
});
test('missing textures, cyclic reskin chains and native skin name collisions fail explicitly',async t=>{
  const x=await fixture(t);await fs.rename(path.join(x.base,'one/page.png'),path.join(x.base,'one/missing.png'));
  await assert.rejects(prepareSkinExport(x));
  assert.throws(()=>mergeSkinJSON(x.output.json,[{name:'bad',baseSkin:'bad'}],['prefix/']),/循环/);
  assert.throws(()=>mergeSkinJSON(x.output.json,[{name:'default',baseSkin:'armored'}],['prefix/']),/重复/);
});
