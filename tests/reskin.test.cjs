const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {PNG} = require('pngjs');
const {Library} = require('../electron/library.cjs');
const {ReskinService} = require('../electron/reskin.cjs');
const {startReskinBridge} = require('../electron/reskin-bridge.cjs');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');

function pixels(value, width=4) {
  const png = new PNG({width,height:4});
  for(let i=0;i<png.data.length;i+=4) { png.data[i]=value;png.data[i+1]=30;png.data[i+2]=50;png.data[i+3]=255; }
  return PNG.sync.write(png);
}
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine-reskin-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'rig.json'),JSON.stringify({skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'}],skins:[{name:'default',attachments:{body:{body:{width:2,height:2}}}}],animations:{idle:{}}}));
  await fs.writeFile(path.join(source,'rig.atlas'),'rig.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n  xy: 1,1\n  size: 2,2\n  orig: 2,2\n  offset: 0,0\n  index: -1\n');
  await fs.writeFile(path.join(source,'rig.png'),pixels(100));
  const lib=new Library(path.join(root,'Library'));await lib.init();
  const imported=await lib.importPaths([source]);assert.deepEqual(imported.errors,[]);
  const asset=lib.asset(imported.added[0]);await lib.update(asset.id,{favorite:true,tags:['keep'],note:'keep me'});
  let changes=0;
  const service=new ReskinService(lib,changed=>{if(changed)changes++;});await service.init();
  const create=()=>service.create({assetId:asset.id,name:'机甲',prompt:'紫发与金属护甲',baseSkin:'default'});
  return {root,source,lib,asset,service,create,changes:()=>changes};
}
test('job snapshots, persisted progress and idempotent same-resource skin application',async t=>{
  const x=await setup(t);const old=await fs.readFile(path.join(x.lib.root,'assets',x.asset.id,'skeleton.json'));
  const {job}=await x.create();const context=await x.service.context(job.id);
  assert.equal(context.asset.id,x.asset.id);assert.match(x.service.handoff(job.id),/spine_reskin_apply/);
  await assert.rejects(x.create(),/进行中/);
  await x.service.update(job.id,'processing','正在重绘');
  const restarted=new ReskinService(x.lib);await restarted.init();assert.equal(restarted.task(job.id).status,'processing');
  await fs.writeFile(context.pages[0].result,pixels(180));
  const result=await x.service.apply(job.id);
  assert.equal(result.job.status,'completed');assert.equal(x.lib.data.assets.length,1);
  assert.deepEqual(x.asset.skins,['default','机甲']);assert.equal(x.asset.contentRevision,1);
  assert.equal(x.asset.favorite,true);assert.deepEqual(x.asset.tags,['keep']);assert.equal(x.asset.note,'keep me');
  assert.deepEqual(await fs.readFile(path.join(x.lib.root,'assets',x.asset.id,'skeleton.json')),old);
  assert.equal(x.asset.reskins[0].baseSkin,'default');assert.equal(x.changes(),1);
  await x.service.apply(job.id);assert.equal(x.asset.contentRevision,1);assert.equal(x.changes(),1);
  await assert.rejects(x.lib.update(x.asset.id,{skins:['default'],contentRevision:0}),/资源已更新/);
  await assert.rejects(x.lib.thumbnail(x.asset.id,'data:image/png;base64,a',0),/资源已更新/);
});
test('bad or unchanged results never modify the original resource',async t=>{
  const x=await setup(t);const {job}=await x.create();const c=await x.service.context(job.id);
  await assert.rejects(x.service.apply(job.id),/没有检测到/);
  await fs.writeFile(c.pages[0].result,pixels(150,8));
  await assert.rejects(x.service.apply(job.id),/尺寸/);
  await fs.writeFile(c.pages[0].result,pixels(150));
  await fs.appendFile(path.join(c.resultDir,'texture.atlas'),'\nchanged');
  await assert.rejects(x.service.apply(job.id),/图集布局/);
  assert.deepEqual(x.asset.skins,['default']);assert.equal(x.asset.reskins,undefined);
});
test('stale tasks, tampered snapshots, path traversal and cancelled jobs are rejected',async t=>{
  const x=await setup(t);const {job}=await x.create();const c=await x.service.context(job.id);
  await assert.rejects(x.service.image(job.id,'source','../../jobs.json'),/目录内/);
  // Directory junctions test realpath containment on Windows without requiring
  // developer mode/admin privileges for file symlinks.
  await fs.symlink(x.source,path.join(c.resultDir,'escape'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(x.service.image(job.id,'result','escape/rig.png'),/目录内/);
  await fs.writeFile(c.pages[0].result,pixels(180));
  await fs.appendFile(c.atlasPath,'\n');
  await assert.rejects(x.service.apply(job.id),/快照已被修改/);
  await fs.writeFile(path.join(x.lib.root,'assets',x.asset.id,'textures/0.png'),pixels(200));
  await assert.rejects(x.service.apply(job.id),/制作期间已更改/);
  await x.service.update(job.id,'cancelled');await assert.rejects(x.service.apply(job.id),/重试/);
  assert.deepEqual(x.asset.skins,['default']);
});
test('MCP stdio exposes tools and serializes a complete job through the authenticated desktop bridge',async t=>{
  const x=await setup(t);let queue=Promise.resolve();
  const bridge=await startReskinBridge({service:x.service,userData:x.root,enqueue:fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;}});
  t.after(()=>bridge.close());
  const descriptor=JSON.parse(await fs.readFile(path.join(x.root,'spine-shelf-mcp.json'),'utf8'));
  assert.equal((await fetch(descriptor.url,{method:'POST',body:'{}'})).status,403);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('electron/mcp-server.cjs'),'--data-dir',x.root],stderr:'pipe'});
  const client=new Client({name:'spine-test',version:'1.0.0'});await client.connect(transport);t.after(()=>client.close());
  const names=(await client.listTools()).tools.map(tool=>tool.name);
  assert.equal(names.filter(name=>name.startsWith('spine_reskin_')).length,7);
  assert.equal(names.filter(name=>name.startsWith('spine_generate_')).length,7);
  const status=await client.callTool({name:'spine_reskin_status',arguments:{}});assert.equal(status.structuredContent.assets,1);
  const created=await client.callTool({name:'spine_reskin_create_task',arguments:{assetId:x.asset.id,name:'MCP 皮肤',prompt:'测试',baseSkin:'default'}});
  const taskId=created.structuredContent.job.id;
  const got=await client.callTool({name:'spine_reskin_get_task',arguments:{taskId}});
  await fs.writeFile(got.structuredContent.pages[0].result,pixels(220));
  const image=await client.callTool({name:'spine_reskin_read_image',arguments:{taskId,area:'result',file:'page-0.png'}});assert.equal(image.content[0].type,'image');
  const applied=await client.callTool({name:'spine_reskin_apply',arguments:{taskId}});
  assert.equal(applied.isError,undefined);assert.equal(applied.structuredContent.job.status,'completed');
  assert.deepEqual(x.asset.skins,['default','MCP 皮肤']);assert.equal(x.lib.data.assets.length,1);
});

async function addSkin(x, name='机甲', baseSkin='default', value=180) {
  const {job} = await x.service.create({assetId:x.asset.id,name,baseSkin,prompt:'紫发与金属护甲'});
  const c = await x.service.context(job.id);
  await fs.writeFile(c.pages[0].result,pixels(value));
  await x.service.apply(job.id);
  return structuredClone(x.asset.reskins.find(s=>s.name===name));
}
const redesign = (x, layer, baseSkin='default') => x.service.create({assetId:x.asset.id,name:layer.name,
  replaceSkin:layer.name,expectedTaskId:layer.taskId,baseSkin,prompt:'修正眼睛和衣服'});
async function archives(x) {
  const root=path.join(x.lib.root,'.trash/skins');
  return Promise.all((await fs.readdir(root)).map(async id=>({dir:path.join(root,id),...JSON.parse(await fs.readFile(path.join(root,id,'change.json'),'utf8'))})));
}

test('redesign retains the old skin until success, replaces in place and preserves chained skins and project references',async t=>{
  const x=await setup(t), base=path.join(x.lib.root,'assets',x.asset.id);
  const original=await fs.readFile(path.join(base,'skeleton.json'));
  const initialSize=x.asset.size;
  const old=await addSkin(x);
  const child=await addSkin(x,'冰甲','机甲',210);
  x.lib.data.projects.push({id:'p',name:'项目',categories:[],members:[{assetId:x.asset.id,skin:'机甲'}]});await x.lib.save();
  const before=structuredClone(x.asset), oldPixels=await fs.readFile(path.join(base,path.dirname(old.atlas),'page-0.png'));
  const {job}=await redesign(x,old,'机甲');
  assert.deepEqual(x.asset,before);assert.equal(job.targetBaseSkin,'default');
  const c=await x.service.context(job.id);assert.deepEqual(await fs.readFile(c.pages[0].source),oldPixels);
  assert.match(x.service.handoff(job.id),/重新设计皮肤/);assert.match(c.instructions,/替换同名/);
  await assert.rejects(x.service.apply(job.id),/没有检测到/);
  assert.deepEqual(x.asset,before);
  await fs.writeFile(c.pages[0].result,pixels(240));
  await x.service.apply(job.id);
  assert.deepEqual(x.asset.skins,['default','机甲','冰甲']);
  assert.equal(x.asset.reskins[0].taskId,job.id);assert.equal(x.asset.reskins[0].baseSkin,'default');
  assert.deepEqual(x.asset.reskins[1],child);assert.equal(x.lib.data.projects[0].members[0].skin,'机甲');
  assert.deepEqual(await fs.readFile(path.join(base,'skeleton.json')),original);
  assert.equal(x.asset.contentRevision,before.contentRevision+1);
  const archive=(await archives(x))[0];assert.equal(archive.state,'archived');
  assert.deepEqual(await fs.readFile(path.join(archive.dir,'files/page-0.png')),oldPixels);
  await assert.rejects(fs.access(path.join(base,old.atlas)),{code:'ENOENT'});
  let extra=0;
  for (const layer of x.asset.reskins) for(const file of ['texture.atlas','page-0.png'])extra+=(await fs.stat(path.join(base,path.dirname(layer.atlas),file))).size;
  assert.equal(x.asset.size,initialSize+extra);
  await x.service.apply(job.id);assert.equal(x.asset.contentRevision,before.contentRevision+1);
  const reloaded=new Library(x.lib.root);await reloaded.init();const service=new ReskinService(reloaded);await service.init();
  assert.deepEqual(reloaded.asset(x.asset.id),x.asset);assert.equal(service.task(job.id).status,'completed');
});

test('delete archives only the selected skin and repairs descendant and project references',async t=>{
  const x=await setup(t), base=path.join(x.lib.root,'assets',x.asset.id);
  const old=await addSkin(x);const child=await addSkin(x,'冰甲','机甲',210);
  const childPixels=await fs.readFile(path.join(base,path.dirname(child.atlas),'page-0.png'));
  const native=await fs.readFile(path.join(base,'textures/0.png'));
  x.lib.data.projects.push({id:'p',name:'项目',categories:[],members:[{assetId:x.asset.id,skin:'机甲'},{assetId:'other',skin:'机甲'}]});await x.lib.save();
  const result=await x.service.remove(x.asset.id,old.name,old.taskId);
  assert.equal(result.fallbackSkin,'default');assert.deepEqual(x.asset.skins,['default','冰甲']);
  assert.equal(x.asset.reskins[0].baseSkin,'default');
  assert.deepEqual(await fs.readFile(path.join(base,path.dirname(child.atlas),'page-0.png')),childPixels);
  assert.deepEqual(await fs.readFile(path.join(base,'textures/0.png')),native);
  assert.deepEqual(x.lib.data.projects[0].members.map(m=>m.skin),['default','机甲']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'reskins.json'),'utf8')).skins,x.asset.reskins);
  assert.equal((await archives(x))[0].state,'archived');
  await x.service.apply(old.taskId);assert.deepEqual(x.asset.skins,['default','冰甲']); // History cannot resurrect deleted skins.
  await assert.rejects(x.service.remove(x.asset.id,'default',''),/原始皮肤/);
  await assert.rejects(x.service.remove(x.asset.id,child.name,'stale'),/已更新/);
  const {job}=await redesign(x,child);await assert.rejects(x.service.remove(x.asset.id,child.name,child.taskId),/进行中/);
  await x.service.update(job.id,'cancelled');await x.service.remove(x.asset.id,child.name,child.taskId);
  assert.deepEqual(x.asset.skins,['default']);
});

test('failed or cancelled redesign preserves existing textures; stale/native targets are rejected',async t=>{
  const x=await setup(t), old=await addSkin(x), before=structuredClone(x.asset);
  await assert.rejects(redesign(x,{name:'default',taskId:''}),/只能重新设计/);
  await assert.rejects(redesign(x,{...old,taskId:'stale'}),/已更新/);
  const {job}=await redesign(x,old);await x.service.update(job.id,'failed','生图失败');
  assert.deepEqual(x.asset,before);
  await x.service.update(job.id,'queued');await x.service.update(job.id,'cancelled');
  await assert.rejects(x.service.apply(job.id),/重试/);assert.deepEqual(x.asset,before);
  const next=await redesign(x,old);await x.service.update(next.job.id,'failed');
  await x.service.remove(x.asset.id,old.name,old.taskId);
  await x.service.update(next.job.id,'queued');await assert.rejects(x.service.apply(next.job.id),/删除或更新/);
  assert.deepEqual(x.asset.skins,['default']);
});

test('disk write failures roll back deletion and replacement including manifest and projects',async t=>{
  const x=await setup(t), old=await addSkin(x), base=path.join(x.lib.root,'assets',x.asset.id);
  x.lib.data.projects.push({id:'p',name:'项目',categories:[],members:[{assetId:x.asset.id,skin:old.name}]});await x.lib.save();
  const before=structuredClone(x.lib.data), save=x.lib.save.bind(x.lib);
  x.lib.save=async()=>{throw new Error('disk full');};
  await assert.rejects(x.service.remove(x.asset.id,old.name,old.taskId),/disk full/);
  assert.deepEqual(x.lib.data,before);await fs.access(path.join(base,old.atlas));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'reskins.json'),'utf8')).skins,x.asset.reskins);
  const {job}=await redesign(x,old), c=await x.service.context(job.id);await fs.writeFile(c.pages[0].result,pixels(240));
  await assert.rejects(x.service.apply(job.id),/disk full/);
  assert.deepEqual(x.lib.data,before);assert.equal(job.status,'failed');await fs.access(path.join(base,old.atlas));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'reskins.json'),'utf8')).skins,x.asset.reskins);
  x.lib.save=save;
  await x.service.update(job.id,'queued');await x.service.apply(job.id);assert.equal(job.status,'completed');
});

test('startup recovers committed archiving and rolls back an interrupted manifest',async t=>{
  const {beginSkinChange}=require('../electron/skin-storage.cjs');
  const x=await setup(t), old=await addSkin(x), base=path.join(x.lib.root,'assets',x.asset.id);
  const rollback=await beginSkinChange(x.lib,x.asset,old,'delete');
  await fs.writeFile(path.join(base,'reskins.json'),JSON.stringify({version:1,skins:[]}));
  await new ReskinService(x.lib).init();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'reskins.json'),'utf8')).skins,x.asset.reskins);
  assert.equal(JSON.parse(await fs.readFile(path.join(rollback.directory,'change.json'),'utf8')).state,'aborted');
  const committed=await beginSkinChange(x.lib,x.asset,old,'delete');
  x.asset.reskins=[];x.asset.skins=['default'];await x.lib.save();
  const reloaded=new Library(x.lib.root);await reloaded.init();await new ReskinService(reloaded).init();
  await fs.access(path.join(committed.directory,'files/page-0.png'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'reskins.json'),'utf8')).skins,[]);
  await new ReskinService(reloaded).init(); // Recovery is repeatable.
});

test('skin deletion refuses native paths or junctions and never moves external files',async t=>{
  const x=await setup(t), old=await addSkin(x), base=path.join(x.lib.root,'assets',x.asset.id);
  const layer=x.asset.reskins[0];layer.atlas='texture.atlas';
  await assert.rejects(x.service.remove(x.asset.id,layer.name,layer.taskId),/目录无效/);
  const directory=path.join(base,path.dirname(old.atlas)), safeCopy=directory+'-saved';
  await fs.rename(directory,safeCopy);
  await fs.symlink(x.source,directory,process.platform==='win32'?'junction':'dir');
  layer.atlas=old.atlas;
  try {
    await assert.rejects(x.service.remove(x.asset.id,layer.name,layer.taskId),/外部位置/);
    assert.deepEqual(x.asset.skins,['default','机甲']);await fs.access(path.join(x.source,'rig.png'));
  } finally {await fs.unlink(directory);await fs.rename(safeCopy,directory);}
});
