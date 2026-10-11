import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'spine-generation-ui-'));
const real=process.env.SPINE_GENERATION_REAL==='1';
const output=path.resolve(real?'test-results/generation-real':'test-results/generation');await fs.mkdir(output,{recursive:true});
const env={...process.env,SPINE_SHELF_DATA:dataDir,SPINE_SHELF_TEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app=await electron.launch({args:[real?'.':'tests/fixtures/generation-app.cjs'],env});
  const page=await app.firstWindow();
  await page.getByRole('button',{name:'制作 Spine',exact:true}).click();
  await page.getByLabel('角色名称',{exact:true}).fill(real?'苔绿小机器人':'森林骑士测试');
  await page.getByLabel('制作需求',{exact:true}).fill(real?'制作一个原创可爱的苔绿色小机器人，橙色玻璃脸，正面2D游戏插画。只需两个透明部件：独立头部，以及含手脚的身体。只调用一次 imagegen 生成左右分离、间隔清楚的两个部件，然后裁剪并用 PNG 透明通道保留轮廓；用头部独立骨骼轻轻摆动、身体呼吸形成 idle。不要添加其他动作或额外绘图。这是小型真实集成验证。':'绿色身体，橙色头部，制作待机和走路动作。');
  assert.equal(await page.getByLabel(/^动作名称 \d+$/).count(),11);
  const initialNames=await page.getByLabel(/^动作名称 \d+$/).evaluateAll(inputs=>inputs.map(i=>i.value));
  assert.deepEqual(initialNames,['attack01','attack02','attack03','walk','born','death','skill','idle','hit01','hit02','out']);
  await page.getByRole('table',{name:/动作设计/}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'action-presets.png')});
  await page.getByRole('button',{name:'新增动作',exact:true}).click();
  await page.getByLabel('动作名称 12',{exact:true}).fill('jump');
  await page.getByLabel('动作内容 12',{exact:true}).fill('向上跳跃后屈膝落地。');
  await page.getByLabel('删除动作 12',{exact:true}).click();
  for(let i=10;i>=0;i--)if(!['idle',...(real?[]:['walk'])].includes(initialNames[i]))await page.getByLabel(`删除动作 ${i+1}`,{exact:true}).click();
  const description='头部左右轻摆，身体呼吸，四秒后恢复起始姿态并循环。';
  await page.getByLabel(`动作内容 ${real?1:2}`,{exact:true}).fill(description);
  await page.reload();
  await page.getByRole('button',{name:'制作 Spine',exact:true}).click();
  assert.equal(await page.getByLabel('角色名称',{exact:true}).inputValue(),real?'苔绿小机器人':'森林骑士测试');
  assert.equal(await page.getByLabel(`动作内容 ${real?1:2}`,{exact:true}).inputValue(),description);
  await page.screenshot({path:path.join(output,'create.png')});
  await page.getByRole('button',{name:/^开始制作 Spine/}).click();
  const deadline=Date.now()+(real?900000:45000);let last='';
  while(Date.now()<deadline) {
    const job=(await page.evaluate(()=>window.shelf.generationList()))[0];
    if(job&&job.message!==last){last=job.message;console.log(job.status,last.slice(0,700));}
    if(job&&['completed','failed','cancelled'].includes(job.status))break;
    await page.waitForTimeout(1000);
  }
  const jobs=await page.evaluate(()=>window.shelf.generationList());
  await fs.cp(path.join(dataDir,'Library','GenerationJobs',jobs[0].id),path.join(output,'job'),{recursive:true});
  assert.equal(jobs[0].status,'completed',jobs[0].message);assert.ok(jobs[0].execution.threadId);
  assert.equal(jobs[0].animationRequirements.find(a=>a.name==='idle').description,description);
  await page.locator('.generation-dialog .reskin-details summary').click();
  await page.screenshot({path:path.join(output,'completed.png')});
  await page.getByRole('button',{name:'查看角色',exact:true}).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="动画"]')?.textContent?.includes('idle'));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.stage-message.error').count(),0);
  const first=await page.locator('.stage canvas').evaluate(c=>c.toDataURL());
  await page.waitForTimeout(300);
  const second=await page.locator('.stage canvas').evaluate(c=>c.toDataURL());
  assert.notEqual(first,second,'Generated rig must visibly animate');
  await page.screenshot({path:path.join(output,'preview.png')});
  const library=await page.evaluate(()=>window.shelf.getLibrary());
  assert.equal(library.assets.filter(a=>a.id===jobs[0].assetId).length,1);
  await page.reload();
  await page.getByRole('button',{name:'制作 Spine',exact:true}).click();
  await page.getByRole('button',{name:'查看角色',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭制作窗口',exact:true}).click();
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('generation:capabilities');ipcMain.handle('generation:capabilities',()=>({actionTable:true}));});
  await page.getByRole('button',{name:'制作 Spine',exact:true}).click();
  await page.getByText(/制作功能已更新，请完全退出 Spine Shelf/).waitFor();
  assert.equal(await page.getByRole('button',{name:/^开始制作 Spine/}).isDisabled(),true);
  assert.equal(await page.getByText(/TypeError/).count(),0);
  await page.screenshot({path:path.join(output,'restart-hint.png')});
  await fs.cp(path.join(dataDir,'Library','assets',jobs[0].assetId),path.join(output,'asset'),{recursive:true});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,real,job:jobs[0]},null,2));
  console.log(`PASS: request UI → ${real?'real Codex + imagegen':'Codex process fixture'} → scoped MCP → compile/validate/import → animated preview → persisted history`);
}finally {
  if(app)await app.close();
  // Delete only this mkdtemp-created test profile.
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep));
  await fs.rm(dataDir,{recursive:true,force:true});
}
