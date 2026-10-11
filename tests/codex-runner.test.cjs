const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {PNG}=require('pngjs');
const {Library}=require('../electron/library.cjs');
const {ReskinService}=require('../electron/reskin.cjs');
const {startReskinBridge}=require('../electron/reskin-bridge.cjs');
const {CodexRunner,childEnvironment,findCodex}=require('../electron/codex-runner.cjs');
test('Windows finds the desktop bundled CLI without PATH or host variables',{skip:process.platform!=='win32'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine-codex-discovery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bin=path.join(root,'OpenAI','Codex','bin');
  const old=path.join(bin,'old','codex.exe'), latest=path.join(bin,'latest','codex.exe');
  for(const file of [old,latest]) {await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');}
  await fs.utimes(old,new Date(1000),new Date(1000));
  await fs.utimes(latest,new Date(2000),new Date(2000));
  assert.equal(await findCodex({LOCALAPPDATA:root,PATH:''}),latest);
  assert.equal(await findCodex({LOCALAPPDATA:root,PATH:'',SPINE_SHELF_CODEX:old}),old);
});
async function setup(t,mode='complete') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spine-direct-test-'));
  const source=path.join(root,'source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'rig.json'),JSON.stringify({skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'}],skins:[{name:'default',attachments:{body:{body:{width:4,height:4}}}}],animations:{idle:{}}}));
  await fs.writeFile(path.join(source,'rig.atlas'),'rig.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n  xy: 0,0\n  size: 4,4\n  orig: 4,4\n  offset: 0,0\n  index: -1\n');
  const png=new PNG({width:4,height:4});png.data.fill(255);await fs.writeFile(path.join(source,'rig.png'),PNG.sync.write(png));
  const library=new Library(path.join(root,'Library'));await library.init();await library.importPaths([source]);
  const service=new ReskinService(library);await service.init();
  let queue=Promise.resolve();const enqueue=fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;};
  const bridge=await startReskinBridge({service,userData:root,enqueue});
  const fixture=path.resolve('tests/fixtures/fake-codex.cjs');
  // Windows cannot execute a shebang script directly. Keep the same real
  // child-process/MCP test there, launching the fixture through Node.
  const runner=new CodexRunner({service,enqueue,userData:root,
    ...(process.platform==='win32' ? {spawnProcess:(_command,args,options)=>spawn(process.execPath,[fixture,...args],options)} : {}),
    env:{...process.env,CODEX_HOME:root,SPINE_SHELF_CODEX:fixture,SPINE_FAKE_CODEX_MODE:mode}});
  if(process.platform==='win32') runner.status=async()=>({ready:true,command:process.execPath,message:'Fixture login'});
  await runner.init();
  const {job}=await service.create({assetId:library.data.assets[0].id,name:'直接生成',prompt:'测试',baseSkin:'default'});
  t.after(async()=>{await runner.shutdown();await bridge.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,service,runner,job,library,bridge,enqueue};
}
test('worker environment reuses saved login without host session credentials',()=>{
  const env=childEnvironment({CODEX_API_KEY:'sensitive',CODEX_THREAD_ID:'parent',CODEX_HOME:'/home/test',OPENAI_API_KEY:'sensitive',ELECTRON_RUN_AS_NODE:'1',PATH:'/bin'});
  assert.deepEqual(env,{CODEX_HOME:'/home/test',PATH:'/bin'});
});
test('start spawns a scoped worker, applies a skin via MCP and records completion',async t=>{
  const x=await setup(t);assert.equal((await x.runner.status()).ready,true);
  await x.runner.start(x.job.id);
  const run=x.runner.runs.get(x.job.id);assert.ok(run);
  await assert.rejects(x.runner.start(x.job.id),/已经在制作/);
  await run.done;
  assert.equal(x.job.status,'completed');assert.equal(x.job.execution.state,'completed');
  assert.equal(x.job.execution.threadId,'fixture-codex-thread');
  assert.deepEqual(x.library.data.assets[0].skins,['default','直接生成']);assert.equal(x.library.data.assets.length,1);
});
test('failed and incomplete turns remain retryable and never report success',async t=>{
  for(const mode of ['fail','no-apply']) {
    const x=await setup(t,mode);await x.runner.start(x.job.id);await x.runner.runs.get(x.job.id).done;
    assert.equal(x.job.status,'failed');assert.equal(x.job.execution.state,'failed');
    assert.deepEqual(x.library.data.assets[0].skins,['default']);
    x.runner.env.SPINE_FAKE_CODEX_MODE='complete';await x.runner.start(x.job.id);await x.runner.runs.get(x.job.id).done;
    assert.equal(x.job.status,'completed');
  }
});
test('cancel stops the child and invalidates its MCP run token',async t=>{
  const x=await setup(t,'wait');await x.runner.start(x.job.id);
  const run=x.runner.runs.get(x.job.id),token=run.token;
  await x.runner.cancel(x.job.id);assert.equal(x.job.status,'cancelled');
  assert.ok(run.child.exitCode!==null || run.child.signalCode);
  const descriptor=JSON.parse(await fs.readFile(path.join(x.root,'spine-shelf-mcp.json'),'utf8'));
  const response=await fetch(descriptor.url,{method:'POST',headers:{Authorization:`Bearer ${descriptor.token}`},body:JSON.stringify({method:'get_task',args:{taskId:x.job.id,runId:token}})});
  assert.equal(response.status,400);assert.match((await response.json()).error,/已停止/);
});
test('restart marks interrupted background jobs failed without touching the asset',async t=>{
  const x=await setup(t);x.job.status='processing';x.job.execution={state:'running',runId:'old'};await x.service.save();
  const runner=new CodexRunner({service:x.service,enqueue:x.enqueue,userData:x.root});await runner.init();
  assert.equal(x.job.status,'failed');assert.equal(x.job.execution.state,'interrupted');assert.equal(x.library.data.assets[0].reskins,undefined);
});
test('details stream tool lifecycles without overwriting specific progress or exposing internal output',async t=>{
  const x=await setup(t,'wait');await x.runner.start(x.job.id);
  const run=x.runner.runs.get(x.job.id);
  // Wait for the child startup events before adding deterministic user-visible events.
  for(let i=0;i<100 && !x.job.execution.threadId;i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(x.job.execution.threadId,'fixture-codex-thread');await x.enqueue(async()=>{});
  x.runner.event(run,{type:'item.completed',item:{id:'message-1',type:'agent_message',text:'已读取 43 个插槽，正在准备机甲重绘。'}});
  x.runner.event(run,{type:'item.started',item:{id:'command-1',type:'command_execution',command:'secret command',aggregated_output:'secret output',status:'in_progress'}});
  x.runner.event(run,{type:'item.completed',item:{id:'reason-1',type:'reasoning',text:'private reasoning'}});
  await x.enqueue(async()=>{});
  let details=await x.runner.details(x.job.id);
  assert.equal(details.running,true);
  assert.equal(details.job.message,'已读取 43 个插槽，正在准备机甲重绘。');
  const started=details.entries.find(e=>e.id.endsWith(':command-1'));
  assert.equal(started.status,'running');assert.ok(started.at);
  x.runner.event(run,{type:'item.completed',item:{id:'command-1',type:'command_execution',status:'failed',exit_code:2,aggregated_output:'secret output'}});
  x.runner.event(run,{type:'item.started',item:{id:'image-1',type:'mcp_tool_call',tool:'imagegen',status:'in_progress'}});
  await x.enqueue(async()=>{});
  details=await x.runner.details(x.job.id);
  const command=details.entries.filter(e=>e.id.endsWith(':command-1'));
  assert.equal(command.length,1);assert.equal(command[0].at,started.at);assert.equal(command[0].exitCode,2);
  assert.equal(command[0].status,'failed');assert.equal(x.job.status,'processing');
  assert.equal(details.entries.at(-1).text,'生成新造型');
  assert.doesNotMatch(JSON.stringify(details),/secret command|secret output|private reasoning/);
  await x.runner.cancel(x.job.id);
  details=await x.runner.details(x.job.id);
  assert.equal(details.running,false);assert.equal(details.entries.some(e=>e.status==='running'),false);
  assert.ok(details.entries.some(e=>e.text==='已取消'));
  const restarted=new ReskinService(x.library);await restarted.init();
  assert.deepEqual((await restarted.progress.load(restarted.task(x.job.id))).entries,details.entries);
});
test('legacy visible logs remain readable without invented timestamps',async t=>{
  const x=await setup(t);
  const dir=x.service.dir(x.job);
  await fs.rm(path.join(dir,'progress.json'));x.service.progress.cache.clear();
  await fs.writeFile(path.join(dir,'codex-events.jsonl'),[
    JSON.stringify({type:'item.completed',itemType:'agent_message',text:'正在生成机甲外观'}),
    'incomplete JSON',
    JSON.stringify({type:'item.completed',itemType:'reasoning',text:'private reasoning'}),
  ].join('\n'));
  const details=await x.runner.details(x.job.id);
  assert.equal(details.entries.length,1);assert.equal(details.entries[0].text,'正在生成机甲外观');
  assert.equal(details.entries[0].legacy,true);assert.equal(details.entries[0].at,undefined);
});
