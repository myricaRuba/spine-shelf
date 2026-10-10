import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';

const real=process.env.SPINE_CODEX_REAL==='1';
const reusedImage=process.env.SPINE_CODEX_REUSE_IMAGE;
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'spine-codex-direct-'));
const output=path.resolve(`test-results/codex-direct-${real?'real':'fixture'}`);
await fs.mkdir(output,{recursive:true});
const source=path.join(dataDir,'fixture');await fs.mkdir(source);
let png;
if(real) png=await fs.readFile(path.resolve('artifacts/reskin-direct/probe/shield.png'));
else {const p=new PNG({width:128,height:128});p.data.fill(255);png=PNG.sync.write(p);}
const size=PNG.sync.read(png);
await fs.writeFile(path.join(source,'direct.png'),png);
await fs.writeFile(path.join(source,'direct.atlas'),`direct.png\nsize: ${size.width},${size.height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n  xy: 0,0\n  size: ${size.width},${size.height}\n  orig: ${size.width},${size.height}\n  offset: 0,0\n  index: -1\n`);
await fs.writeFile(path.join(source,'direct.json'),JSON.stringify({skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'}],skins:[{name:'default',attachments:{body:{body:{width:256,height:256}}}}],animations:{idle:{}}}));
const env={...process.env,SPINE_SHELF_DATA:dataDir,SPINE_SHELF_TEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;
if(!real) {env.SPINE_SHELF_CODEX=path.resolve('tests/fixtures/fake-codex.cjs');env.SPINE_FAKE_CODEX_PROGRESS_DELAY='6000';}
const executablePath=process.env.SPINE_TEST_APP;
let app;
try {
  app=await electron.launch({...executablePath?{executablePath,args:[]}:{args:['.']},env,cwd:process.cwd()});
  const page=await app.firstWindow();await page.waitForSelector('.asset-card');
  const imported=await page.evaluate(p=>window.shelf.importPaths([p]),source);assert.deepEqual(imported.errors,[]);
  const id=imported.added[0];const count=imported.library.assets.length;
  await page.reload();await page.getByLabel('搜索资源').fill('direct');
  await page.getByRole('button',{name:'预览 direct',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ready-dot')?.textContent==='已就绪');
  await page.getByRole('button',{name:'资源信息',exact:true}).click();
  await page.getByLabel('新皮肤名称').fill('直接制作验证');
  await page.getByLabel('换肤要求').fill(real ? (reusedImage ? `这是上一轮已经完成 imagegen 的集成验证复测，直接复用生成图片 ${reusedImage}，不要再次生图。把其中青绿色菱形核心局部回填到当前盾牌，保持中央核心之外的原图像素和透明通道，恢复原尺寸后通过 MCP 提交即可。已经完成生成，本轮只验证后台任务到软件写回，不要启动浏览器或操作软件窗口，软件会自己刷新预览。` : '这是端到端集成验证素材：请用内置 imagegen 编辑这个盾牌，在盾牌中央加入一个青绿色发光菱形核心，其余紫色装甲、外轮廓、居中位置和透明背景保持。只生成一次图片，不做额外方案。图集只有 body 这一个图块，请回到原贴图像素尺寸后提交，不修改骨骼。') : '自动化进程测试');
  await page.waitForFunction(()=>!document.querySelector('.reskin-form .primary')?.disabled);
  await page.getByRole('button',{name:'开始制作',exact:true}).click();
  if(!real) {
    await page.locator('.reskin-operation').filter({hasText:'生成新造型'}).waitFor();
    await page.locator('.reskin-details summary').click();
    await page.getByRole('button',{name:'全部操作',exact:true}).click();
    await page.locator('.reskin-log-entry.running').filter({hasText:'生成新造型'}).waitFor();
    assert.match(await page.locator('.reskin-timing').innerText(),/已用/);
    await page.screenshot({path:path.join(output,'progress-running.png')});
  }
  const start=Date.now();let job,last='';
  while(Date.now()-start<(real?720000:30000)) {
    job=(await page.evaluate(id=>window.shelf.reskinList(id),id))[0];
    if(job && `${job.status}:${job.message}`!==last) {last=`${job.status}:${job.message}`;console.log('DIRECT',last.slice(0,400));}
    if(job && ['completed','failed','cancelled'].includes(job.status))break;
    await page.waitForTimeout(1000);
  }
  assert.equal(job?.status,'completed',job?.message || await page.locator('.reskin-error').allTextContents());
  assert.ok(job.execution?.threadId);assert.ok(job.execution?.runId);
  const details=await page.evaluate(id=>window.shelf.reskinDetails(id),job.id);
  assert.ok(details.entries.some(e=>e.text==='新皮肤已添加'));
  if(!real) {
    const generated=details.entries.filter(e=>e.text==='生成新造型');
    assert.equal(generated.length,1);assert.equal(generated[0].status,'completed');
  }
  await fs.cp(path.join(dataDir,'Library/ReskinJobs',job.id),path.join(output,'job'),{recursive:true});
  await page.getByLabel('搜索资源').fill('direct');
  await page.getByRole('button',{name:'预览 direct',exact:true}).click();
  await page.getByRole('button',{name:'资源信息',exact:true}).click();
  await page.screenshot({path:path.join(output,'before-view-skin.png')});
  await page.getByRole('button',{name:'查看皮肤',exact:true}).click();
  await page.getByRole('button',{name:'动画预览',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="皮肤"]')?.value==='直接制作验证');
  assert.equal(await page.locator('.stage-message.error').count(),0);
  const library=await page.evaluate(()=>window.shelf.getLibrary());
  assert.equal(library.assets.length,count);assert.deepEqual(library.assets.find(a=>a.id===id).skins,['default','直接制作验证']);
  await page.screenshot({path:path.join(output,'completed.png')});
  await page.reload();
  await page.getByLabel('搜索资源').fill('direct');
  await page.getByRole('button',{name:'预览 direct',exact:true}).click();
  await page.getByRole('button',{name:'资源信息',exact:true}).click();
  await page.locator('.reskin-details summary').click();
  await page.getByRole('button',{name:'全部操作',exact:true}).click();
  await page.locator('.reskin-log-entry').filter({hasText:'新皮肤已添加'}).waitFor();
  assert.ok((await page.evaluate(id=>window.shelf.reskinDetails(id),job.id)).entries.length >= details.entries.length);
  await page.screenshot({path:path.join(output,'progress-restored.png')});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,realCodex:real,reusedImage:!!reusedImage,packaged:!!executablePath,assetId:id,assets:count,job},null,2));
  console.log(`PASS: UI button → ${real ? (reusedImage ? 'real Codex with existing imagegen output' : 'real Codex + built-in imagegen') : 'process fixture'} → scoped MCP → same asset skin`);
} finally {
  if(app)await app.close();
  await fs.rm(dataDir,{recursive:true,force:true});
}
