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
  await fs.symlink(path.join(x.source,'rig.png'),path.join(c.resultDir,'escape.png'));
  await assert.rejects(x.service.image(job.id,'result','escape.png'),/目录内/);
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
  assert.equal((await client.listTools()).tools.length,7);
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
