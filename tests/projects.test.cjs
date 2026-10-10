const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {PNG}=require('pngjs');
const yauzl=require('yauzl');
const {Library}=require('../electron/library.cjs');
const {ProjectService}=require('../electron/projects.cjs');
const {ReskinService}=require('../electron/reskin.cjs');
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine-project-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const library=new Library(path.join(root,'Library'));await library.init();
  await library.importPaths([path.resolve('resources/examples/spineboy')]);
  const service=new ProjectService(library),asset=library.data.assets[0];
  return {root,library,service,asset};
}
async function unzip(file) {
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(err,zip)=>{
    if(err)return reject(err);const files=new Map();
    zip.on('error',reject);zip.on('end',()=>resolve(files));zip.on('entry',entry=>{
      zip.openReadStream(entry,(err,stream)=>{
        if(err)return reject(err);const parts=[];stream.on('error',reject);stream.on('data',b=>parts.push(b));stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(parts));zip.readEntry();});
      });
    });zip.readEntry();
  }));
}
test('projects migrate old libraries and independently reference shared assets with durable categories',async t=>{
  const x=await setup(t);delete x.library.data.projects;await x.library.save();await x.library.init();assert.deepEqual(x.library.data.projects,[]);
  const a=(await x.service.mutate('create',{name:'森林冒险'})).projectId;
  const b=(await x.service.mutate('create',{name:'第二个项目'})).projectId;
  await x.service.mutate('add',{projectId:a,assetIds:[x.asset.id,x.asset.id]});
  await x.service.mutate('add',{projectId:b,assetIds:[x.asset.id],categoryId:'terrain'});
  assert.equal(x.service.project(a).members.length,1);assert.equal(x.service.project(b).members[0].categoryId,'terrain');
  await x.service.mutate('category',{projectId:a,name:'怪物'});const category=x.service.project(a).categories.at(-1);
  await x.service.mutate('member',{projectId:a,assetId:x.asset.id,categoryId:category.id,skin:x.asset.skins[0],label:'森林守卫',note:'第一关'});
  await x.service.mutate('add',{projectId:a,assetIds:[x.asset.id],categoryId:'ui'});
  assert.equal(x.service.project(a).members[0].categoryId,category.id);
  await assert.rejects(x.service.mutate('removeCategory',{projectId:a,categoryId:category.id}),/先将/);
  await assert.rejects(x.library.remove(x.asset.id),/正在用于项目/);
  const old=structuredClone(x.library.data.projects);
  await assert.rejects(x.service.mutate('add',{projectId:a,assetIds:[x.asset.id,'missing']}),/不存在/);
  assert.deepEqual(x.library.data.projects,old);
  const reloaded=new Library(x.library.root);await reloaded.init();assert.deepEqual(reloaded.data.projects,old);
  await x.service.mutate('removeMembers',{projectId:a,assetIds:[x.asset.id]});
  await x.service.mutate('remove',{projectId:b});assert.equal(x.library.data.assets.length,1);
  await x.library.remove(x.asset.id);assert.equal(x.library.data.assets.length,0);
});
test('ZIP exports selected AI appearance, portable atlas paths, manifests and verified file checksums',async t=>{
  const x=await setup(t),reskins=new ReskinService(x.library);await reskins.init();
  const {job}=await reskins.create({assetId:x.asset.id,name:'青色机甲',baseSkin:x.asset.skins[0],prompt:'fixture'});
  const context=await reskins.context(job.id);
  const image=PNG.sync.read(await fs.readFile(context.pages[0].result));
  for(let i=0;i<image.data.length;i+=4)image.data[i]=Math.round(image.data[i]*0.2);
  await fs.writeFile(context.pages[0].result,PNG.sync.write(image));await reskins.apply(job.id);
  const projectId=(await x.service.mutate('create',{name:'森林/冒险'})).projectId;
  await x.service.mutate('add',{projectId:projectId,assetIds:[x.asset.id]});
  await x.service.mutate('member',{projectId,assetId:x.asset.id,categoryId:'character',skin:'青色机甲',label:'../英雄',note:'主角'});
  const skeletonBefore=await fs.readFile(path.join(x.library.root,'assets',x.asset.id,'skeleton.json'));
  const ticks=[];const target=path.join(x.root,'项目.zip');const result=await x.service.export(projectId,target,p=>ticks.push(p));
  assert.equal(result.assets,1);assert.equal(result.bakedSkins,1);assert.equal(ticks.at(-1).phase,'packing');
  const files=await unzip(target);const projectFile=[...files.keys()].find(k=>k.endsWith('/project.json'));
  const prefix=projectFile.slice(0,-'project.json'.length),manifest=JSON.parse(files.get(projectFile));const entry=manifest.assets[0];
  assert.equal(entry.skin,'青色机甲');assert.equal(entry.runtimeSkin,x.asset.skins[0]);assert.equal(entry.bakedSkin,true);
  assert.deepEqual(files.get(prefix+entry.skeleton),skeletonBefore);
  assert.deepEqual(files.get(prefix+entry.textures[0]),await fs.readFile(context.pages[0].result));
  assert.match(files.get(prefix+entry.atlas).toString(),/^textures\/page-0.png/);
  assert.ok([...files.keys()].every(k=>!k.split('/').includes('..') && !k.includes('\\') && !k.startsWith('/')));
  assert.doesNotMatch(files.get(projectFile).toString(),/sourceDigest|sourceDir|ReskinJobs|\/Users\/|[A-Z]:\\/);
  for(const line of files.get(prefix+'SHA256SUMS.txt').toString().trim().split('\n')) {
    const hash=line.slice(0,64),relative=line.slice(66);assert.equal(createHash('sha256').update(files.get(prefix+relative)).digest('hex'),hash);
  }
  assert.deepEqual(await fs.readFile(path.join(x.library.root,'assets',x.asset.id,'skeleton.json')),skeletonBefore);
  await x.service.mutate('member',{projectId,assetId:x.asset.id,categoryId:'terrain',skin:x.asset.skins[0]});
  await x.service.export(projectId,target);const native=await unzip(target);
  const nativeManifest=JSON.parse(native.get(projectFile));assert.equal(nativeManifest.assets[0].bakedSkin,false);
  assert.deepEqual(native.get(prefix+nativeManifest.assets[0].textures[0]),await fs.readFile(path.join(x.library.root,'assets',x.asset.id,'textures/0.png')));
});
test('export failures leave existing files intact and reject writes into the source library',async t=>{
  const x=await setup(t),id=(await x.service.mutate('create',{name:'失败校验'})).projectId;
  await assert.rejects(x.service.export(id,path.join(x.root,'empty.zip')),/还没有素材/);
  await x.service.mutate('add',{projectId:id,assetIds:[x.asset.id]});
  await assert.rejects(x.service.export(id,path.join(x.library.root,'bad.zip')),/目录之外/);
  const dest=path.join(x.root,'keep.zip');await fs.writeFile(dest,'keep original');
  await fs.rm(path.join(x.library.root,'assets',x.asset.id,'textures/0.png'));
  await assert.rejects(x.service.export(id,dest));assert.equal(await fs.readFile(dest,'utf8'),'keep original');
  assert.equal((await fs.readdir(x.root)).some(n=>n.startsWith('.spine-export-')),false);
});
test('sanitized folder collisions preserve every asset and CSV treats names as text',async t=>{
  const x=await setup(t),second=structuredClone(x.asset);
  second.id=x.asset.id.slice(0,8)+'-second';
  const original=path.join(x.library.root,'assets',x.asset.id),copy=path.join(x.library.root,'assets',second.id);
  await fs.cp(original,copy,{recursive:true});await fs.appendFile(path.join(copy,'skeleton.json'),'\n');
  x.library.data.assets.push(second);
  const id=(await x.service.mutate('create',{name:'名称冲突测试'})).projectId;
  await x.service.mutate('add',{projectId:id,assetIds:[x.asset.id,second.id],categoryId:'character'});
  await x.service.mutate('member',{projectId:id,assetId:x.asset.id,categoryId:'character',skin:x.asset.skins[0],label:'A/B'});
  await x.service.mutate('member',{projectId:id,assetId:second.id,categoryId:'character',skin:second.skins[0],label:'A\\B'});
  await x.service.mutate('category',{projectId:id,categoryId:'character',name:'=2+2'});
  x.service.project(id).categories.push({id:'12345678-a',name:'A/B'},{id:'12345678-b',name:'A\\B'});
  const target=path.join(x.root,'names.zip');await x.service.export(id,target);
  const files=await unzip(target),prefix='名称冲突测试/';
  const manifest=JSON.parse(files.get(prefix+'project.json'));
  assert.equal(new Set(manifest.categories.map(c=>c.folder.toLowerCase())).size,manifest.categories.length);
  assert.notEqual(manifest.assets[0].skeleton,manifest.assets[1].skeleton);
  for(const [index,source] of [original,copy].entries())assert.deepEqual(files.get(prefix+manifest.assets[index].skeleton),await fs.readFile(path.join(source,'skeleton.json')));
  assert.match(files.get(prefix+'资源清单.csv').toString(),/"'=2\+2"/);
  assert.equal(manifest.assets[0].category,'=2+2');
});
