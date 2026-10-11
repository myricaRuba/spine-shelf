const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {PNG}=require('pngjs');
const {Library}=require('../electron/library.cjs');
const {GenerationService}=require('../electron/generation.cjs');
const {buildSpine}=require('../electron/spine-builder.cjs');
const {ReskinService}=require('../electron/reskin.cjs');
const {startReskinBridge}=require('../electron/reskin-bridge.cjs');
const {CodexRunner}=require('../electron/codex-runner.cjs');
const {spawn}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine-generation-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const library=new Library(path.join(root,'Library'));await library.init();
  const service=new GenerationService(library);await service.init();
  const {job}=await service.create({name:'森林骑士',prompt:'绿色盔甲，待机呼吸',animations:['idle']});
  const result=path.join(service.dir(job),'result');
  const png=new PNG({width:32,height:32});png.data.fill(255);png.data[3]=0;
  await fs.writeFile(path.join(result,'body.png'),PNG.sync.write(png));
  await fs.writeFile(path.join(result,'head.png'),PNG.sync.write(png));
  const manifest=(await service.context(job.id)).manifest;
  await fs.writeFile(path.join(result,'rig.json'),JSON.stringify(manifest));
  return {root,library,service,job,result,manifest};
}
test('generation compiles a playable Spine, imports once and persists after restart',async t=>{
  const x=await setup(t);
  const {asset,validation}=await x.service.apply(x.job.id);
  assert.equal(asset.name,'森林骑士');assert.equal(asset.runtime,'4.2');assert.deepEqual(asset.animations,['idle']);
  assert.equal(validation.parts,2);assert.equal(asset.generationTaskId,x.job.id);
  assert.equal((await x.service.apply(x.job.id)).asset.id,asset.id);assert.equal(x.library.data.assets.length,1);
  const restarted=new GenerationService(x.library);await restarted.init();assert.equal(restarted.task(x.job.id).status,'completed');
  const json=JSON.parse(await fs.readFile(path.join(x.library.root,'assets',asset.id,'skeleton.json'),'utf8'));
  assert.equal(json.animations.idle.bones.body.rotate[1].value,2);
});
test('invalid rigs cannot enter the library; corrected results can retry',async t=>{
  const x=await setup(t);
  x.manifest.bones[1].parent='missing';
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  await assert.rejects(x.service.apply(x.job.id),/父骨骼/);assert.equal(x.library.data.assets.length,0);
  x.manifest.bones[1].parent='root';x.manifest.parts[0].file='../outside.png';
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  await assert.rejects(x.service.apply(x.job.id),/格式无效/);
  x.manifest.parts[0].file='body.png';x.manifest.animations.idle.bones.body.rotate.forEach(f=>f.value=0);
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  await assert.rejects(x.service.apply(x.job.id),/没有变化/);assert.equal(x.library.data.assets.length,0);
});
test('rejects missing requested actions, opaque parts, and cancelled submissions',async t=>{
  const x=await setup(t);
  await assert.rejects(buildSpine(x.result,path.join(x.root,'compiled'),['walk']),/缺少要求的动画/);
  const png=new PNG({width:32,height:32});png.data.fill(255);
  await fs.writeFile(path.join(x.result,'body.png'),PNG.sync.write(png));
  await assert.rejects(x.service.apply(x.job.id),/透明背景/);
  await x.service.update(x.job.id,'cancelled');await assert.rejects(x.service.apply(x.job.id),/开始或重试/);
});
test('generation rejects a second active job and supports recovery after import interruption',async t=>{
  const x=await setup(t);
  await assert.rejects(x.service.create({name:'第二个',prompt:'角色'}),/已有 Spine/);
  await x.service.apply(x.job.id);
  x.job.status='applying';x.job.assetId='';await x.service.save();
  const restarted=new GenerationService(x.library);await restarted.init();
  assert.equal(restarted.task(x.job.id).status,'completed');assert.equal(restarted.task(x.job.id).assetId,x.library.data.assets[0].id);
});
test('action descriptions survive persistence and reach both the worker prompt and MCP context',async t=>{
  const x=await setup(t);await x.service.update(x.job.id,'cancelled');
  const actions=[{name:' attack01 ',description:' 抽剑横斩，随后收剑。 '},{name:'idle',description:'身体呼吸，盾牌随手臂小幅摆动。'}];
  const {job}=await x.service.create({name:'动作表',prompt:'骑士',animationRequirements:actions});
  assert.deepEqual(job.animations,['attack01','idle']);
  assert.match(x.service.handoff(job.id),/attack01：抽剑横斩，随后收剑。/);
  const restarted=new GenerationService(x.library);await restarted.init();
  assert.deepEqual((await restarted.context(job.id)).job.animationRequirements,[{name:'attack01',description:'抽剑横斩，随后收剑。'},{name:'idle',description:'身体呼吸，盾牌随手臂小幅摆动。'}]);
});
test('action table validates names, duplicates, descriptions and conflicting legacy input',async t=>{
  const x=await setup(t);await x.service.update(x.job.id,'cancelled');
  const create=animationRequirements=>x.service.create({name:'动作表',prompt:'骑士',animationRequirements});
  await assert.rejects(create([]),/1–32/);
  await assert.rejects(create([{name:'attack',description:'  '}]),/动作内容/);
  await assert.rejects(create([{name:'attack',description:'挥剑'},{name:' attack ',description:'收剑'}]),/不重复/);
  await assert.rejects(create([{name:'bad name',description:'跳跃'}]),/英文动作/);
  await assert.rejects(x.service.create({name:'test',prompt:'test',animations:['idle'],animationRequirements:[{name:'walk',description:'行走'}]}),/不一致/);
  assert.equal(x.service.jobs.length,1);
});
test('default actions include the eleven requested presets and can be extended beyond twelve',async t=>{
  const x=await setup(t);await x.service.update(x.job.id,'cancelled');
  const {job}=await x.service.create({name:'预设',prompt:'角色'});
  assert.deepEqual(job.animations,['attack01','attack02','attack03','walk','born','death','skill','idle','hit01','hit02','out']);
  await x.service.update(job.id,'cancelled');
  const actions=[...job.animationRequirements,{name:'jump',description:'跳跃'},{name:'run',description:'奔跑'}];
  const extended=await x.service.create({name:'扩展',prompt:'角色',animationRequirements:actions});
  assert.equal(extended.job.animations.length,13);
  const timeline=x.manifest.animations.idle;
  x.manifest.animations=Object.fromEntries(actions.map(a=>[a.name,timeline]));
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  const built=await buildSpine(x.result,path.join(x.root,'compiled'),extended.job.animations);
  assert.equal(built.animations.length,13);
});
test('cancelled generation workers cannot submit, and their MCP exposes only generation tools',async t=>{
  const x=await setup(t), reskins=new ReskinService(x.library);await reskins.init();
  let queue=Promise.resolve();const enqueue=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  const bridge=await startReskinBridge({service:reskins,generation:x.service,userData:x.root,enqueue});
  const fixture=path.resolve('tests/fixtures/generation-codex.cjs');
  const runner=new CodexRunner({service:x.service,userData:x.root,enqueue,env:{...process.env,SPINE_FAKE_GENERATION_MODE:'wait'},spawnProcess:(_command,args,options)=>spawn(process.execPath,[fixture,...args],options)});
  runner.status=async()=>({ready:true,command:process.execPath});
  const client=new Client({name:'generation-scope-test',version:'1.0.0'});
  t.after(async()=>{await client.close();await runner.shutdown();await bridge.close();});
  await runner.start(x.job.id);const run=runner.runs.get(x.job.id);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('electron/mcp-server.cjs'),'--data-dir',x.root,'--task-id',x.job.id,'--run-id',run.token,'--task-kind','generation']}));
  const names=(await client.listTools()).tools.map(t=>t.name);
  assert.ok(names.includes('spine_generate_apply'));assert.ok(!names.some(n=>n.startsWith('spine_reskin_')));
  assert.ok(names.includes('spine_generate_preview'));
  const preview=await client.callTool({name:'spine_generate_preview',arguments:{taskId:x.job.id}});
  assert.ok(!preview.isError);assert.equal(x.library.data.assets.length,0);
  await runner.cancel(x.job.id);
  const stoppedPreview=await client.callTool({name:'spine_generate_preview',arguments:{taskId:x.job.id}});
  assert.equal(stoppedPreview.isError,true);
  const response=await client.callTool({name:'spine_generate_apply',arguments:{taskId:x.job.id}});
  assert.equal(response.isError,true);assert.match(response.content[0].text,/停止|替代/);
  assert.equal(x.library.data.assets.length,0);
});

async function runtimeRig(output) {
  const rt=await import('spine42');
  const atlas=new rt.TextureAtlas(await fs.readFile(path.join(output,'texture.atlas'),'utf8'));
  for(const p of atlas.pages)p.setTexture(new rt.FakeTexture({width:p.width,height:p.height}));
  const json=JSON.parse(await fs.readFile(path.join(output,'skeleton.json'),'utf8'));
  const data=new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(json),skeleton=new rt.Skeleton(data);
  const pose=(name,time)=>{skeleton.setToSetupPose();data.findAnimation(name).apply(skeleton,-1,time,false,[],1,rt.MixBlend.replace,rt.MixDirection.mixIn);skeleton.updateWorldTransform(rt.Physics.none);};
  return {rt,json,data,skeleton,pose};
}

test('weighted meshes keep the authored bind pose and bend around the named joint',async t=>{
  const x=await setup(t);
  x.manifest.bones=[{name:'root',x:30,y:20,rotation:30},{name:'body',parent:'root',x:10,y:15},{name:'tip',parent:'body',x:0,y:20}];
  x.manifest.parts[0]={name:'body',bone:'body',file:'body.png',x:4,y:6,rotation:15,mesh:{
    vertices:[{x:-10,y:0,u:0,v:1,weights:[{bone:'body',weight:1}]},{x:10,y:0,u:1,v:1,weights:[{bone:'body',weight:1}]},{x:-10,y:40,u:0,v:0,weights:[{bone:'tip',weight:1}]},{x:10,y:40,u:1,v:0,weights:[{bone:'body',weight:.25},{bone:'tip',weight:.75}]}],triangles:[0,1,2,1,3,2]}};
  x.manifest.animations={idle:{bones:{tip:{rotate:[{time:0,value:0},{time:1,value:90}]}}}};
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  const output=path.join(x.root,'compiled'),report=await buildSpine(x.result,output,['idle']);assert.equal(report.meshes,1);
  const {rt,skeleton,pose}=await runtimeRig(output);pose('idle',0);
  const slot=skeleton.findSlot('body'),attachment=slot.attachment,vertices=new Float32Array(8);
  attachment.computeWorldVertices(slot,0,8,vertices,0,2);
  const before=Array.from(vertices),rad=Math.PI/12;
  for(const [i,v] of x.manifest.parts[0].mesh.vertices.entries()){
    const expected=slot.bone.localToWorld(new rt.Vector2(4+v.x*Math.cos(rad)-v.y*Math.sin(rad),6+v.x*Math.sin(rad)+v.y*Math.cos(rad)));
    assert.ok(Math.abs(vertices[i*2]-expected.x)<.001&&Math.abs(vertices[i*2+1]-expected.y)<.001,'part and parent transforms must be preserved in bind pose');
  }
  pose('idle',1);attachment.computeWorldVertices(slot,0,8,vertices,0,2);
  assert.ok(Math.abs(before[0]-vertices[0])<.001);assert.ok(Math.abs(before[1]-vertices[1])<.001);
  assert.ok(Math.hypot(before[4]-vertices[4],before[5]-vertices[5])>10,'the free end must deform, not rotate the entire attachment');
});

test('two-bone IK keeps the endpoint planted while the pelvis moves',async t=>{
  const x=await setup(t);
  x.manifest.bones=[{name:'root'},{name:'body',parent:'root'},{name:'upper',parent:'body',y:70,rotation:-90,length:45},{name:'lower',parent:'upper',x:45,length:45},{name:'foot',parent:'lower',x:45},{name:'target',parent:'root',x:15,y:0}];
  x.manifest.ik=[{name:'leg',bones:['upper','lower'],target:'target'}];
  x.manifest.animations={idle:{bones:{body:{translate:[{time:0,x:0,y:0},{time:1,x:10,y:5},{time:2,x:0,y:0}]}},loop:true}};
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  const output=path.join(x.root,'compiled');await buildSpine(x.result,output,['idle']);
  const {skeleton,pose}=await runtimeRig(output);
  for(const time of [0,.25,.75,1,1.5,2]){pose('idle',time);const foot=skeleton.findBone('foot');assert.ok(Math.abs(foot.worldX-15)<.001&&Math.abs(foot.worldY)<.001,'IK endpoint must stay on the fixed ground target');}
});

test('normalized easing becomes correct absolute 4.2 curves for both channels',async t=>{
  const x=await setup(t);
  x.manifest.animations={idle:{bones:{body:{translate:[{time:0,x:0,y:0,ease:[.42,0,.58,1]},{time:2,x:100,y:50}]}}}};
  await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));
  const output=path.join(x.root,'compiled');await buildSpine(x.result,output,['idle']);
  const {json,skeleton,pose}=await runtimeRig(output);assert.equal(json.animations.idle.bones.body.translate[0].curve.length,8);
  pose('idle',.5);const b=skeleton.findBone('body');assert.ok(b.x>10&&b.x<16,'quarter-time easing should differ from linear x=25');assert.ok(Math.abs(b.y-150-b.x/2)<.001);
});

test('rejects malformed weights, degenerate topology, cyclic IK and a broken declared loop',async t=>{
  const x=await setup(t),output=path.join(x.root,'compiled');
  const build=async()=>{await fs.writeFile(path.join(x.result,'rig.json'),JSON.stringify(x.manifest));return buildSpine(x.result,output,['idle']);};
  x.manifest.parts[0].mesh={vertices:[{x:0,y:0,u:0,v:0,weights:[{bone:'body',weight:.5}]},{x:10,y:0,u:1,v:0,weights:[{bone:'body',weight:1}]},{x:0,y:10,u:0,v:1,weights:[{bone:'body',weight:1}]}],triangles:[0,1,2]};
  await assert.rejects(build(),/权重之和/);x.manifest.parts[0].mesh.vertices[0].weights[0].weight=1;
  x.manifest.parts[0].mesh.triangles=[0,1,3];await assert.rejects(build(),/三角形索引/);
  x.manifest.parts[0].mesh.triangles=[0,1,2];x.manifest.parts[0].mesh.vertices[2].y=0;await assert.rejects(build(),/退化/);
  delete x.manifest.parts[0].mesh;x.manifest.bones[1].length=30;
  x.manifest.bones.push({name:'target',parent:'body',x:30});x.manifest.ik=[{name:'bad',bones:['body'],target:'target'}];await assert.rejects(build(),/IK 目标/);
  delete x.manifest.ik;x.manifest.animations.idle.loop=true;x.manifest.animations.idle.bones.body.rotate[2].value=40;await assert.rejects(build(),/首尾网格未衔接/);
});

test('preview compiles offline inspection without importing or completing a task',async t=>{
  const x=await setup(t),result=await x.service.preview(x.job.id);
  assert.equal(x.library.data.assets.length,0);assert.equal(x.job.status,'queued');
  const html=await fs.readFile(result.previewPath,'utf8');assert.match(html,/window.spinePreview/);assert.match(html,/Spine Runtimes License Agreement/);assert.match(html,/骨骼与网格/);
  assert.match(x.service.handoff(x.job.id),/spine_generate_preview/);assert.match(JSON.stringify((await x.service.context(x.job.id)).schema),/weights/);
});
