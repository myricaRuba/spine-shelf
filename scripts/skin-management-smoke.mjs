import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
const require=createRequire(import.meta.url);
const {Library}=require('../electron/library.cjs');
const {ReskinService}=require('../electron/reskin.cjs');
const {ProjectService}=require('../electron/projects.cjs');
const data=await fs.mkdtemp(path.join(os.tmpdir(),'spine-skin-management-'));
const output=path.resolve('test-results/skin-management');await fs.mkdir(output,{recursive:true});
const library=new Library(path.join(data,'Library'));await library.init();
await library.importPaths([path.resolve('resources/examples/spineboy')]);library.data.seeded=true;await library.save();
const asset=library.data.assets[0], service=new ReskinService(library);await service.init();
async function seed(name,baseSkin,channel) {
  const {job}=await service.create({assetId:asset.id,name,baseSkin,prompt:'森林守卫，绿色护甲；保留原动画'});
  const context=await service.context(job.id);
  for(const p of context.pages){const png=PNG.sync.read(await fs.readFile(p.result));for(let i=0;i<png.data.length;i+=4)png.data[i+channel]=Math.round(png.data[i+channel]*.35);await fs.writeFile(p.result,PNG.sync.write(png));}
  await service.apply(job.id);
}
await seed('森林守卫','default',2);await seed('寒冰守卫','森林守卫',0);
const projects=new ProjectService(library), {projectId}=await projects.mutate('create',{name:'皮肤测试'});
await projects.mutate('add',{projectId,assetIds:[asset.id]});
await projects.mutate('member',{projectId,assetId:asset.id,categoryId:'character',skin:'森林守卫'});
const env={...process.env,SPINE_SHELF_DATA:data,SPINE_SHELF_TEST:'1',SPINE_SHELF_CODEX:path.resolve('tests/fixtures/fake-codex.cjs'),SPINE_FAKE_CODEX_PROGRESS_DELAY:'1200'};
delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
let app,page;
async function frame(skin) {
  await page.getByRole('button',{name:'动画预览',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ready-dot')?.textContent==='已就绪');
  await page.waitForTimeout(200);
  await page.getByLabel('皮肤',{exact:true}).selectOption(skin);
  await page.getByLabel('动画',{exact:true}).selectOption('walk');
  const pause=page.getByRole('button',{name:'暂停',exact:true});if(await pause.count())await pause.click();
  await page.locator('[data-tooltip="将播放进度回到第一帧"]').click();
  await page.locator('[data-tooltip="适应画布：居中并重置缩放（F）"]').click();
  await page.waitForTimeout(180);
  return page.locator('.stage canvas').evaluate(c=>c.toDataURL());
}
async function finish(status) {
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const job=(await page.evaluate(id=>window.shelf.reskinList(id),asset.id))[0];
    if(job.status===status)return;
    if(['failed','cancelled','completed'].includes(job.status))throw new Error(`Expected ${status}: ${job.message}`);
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for ${status}`);
}
try {
  app=await electron.launch({args:['tests/fixtures/skin-management-app.cjs'],env,cwd:process.cwd()});page=await app.firstWindow();
  await page.getByRole('button',{name:'皮肤测试',exact:false}).click();
  await page.getByRole('button',{name:'预览 spineboy-pro',exact:true}).click();
  const original=await frame('default');
  assert.equal(await page.getByRole('button',{name:'删除皮肤',exact:true}).count(),0);
  const child=await frame('寒冰守卫'), before=await frame('森林守卫');
  await page.getByRole('button',{name:'重新设计皮肤',exact:true}).click();
  await page.getByLabel('新的设计要求').waitFor();
  await page.waitForFunction(()=>!document.querySelector('.skin-dialog textarea')?.disabled);
  assert.match(await page.getByLabel('新的设计要求').inputValue(),/森林守卫/);
  assert.equal(await page.getByLabel('重新设计基础').inputValue(),'default');
  await page.getByLabel('重新设计基础').selectOption('森林守卫');
  await page.getByLabel('新的设计要求').fill('修正眼睛、盾牌；保留绿甲和动作');
  await page.screenshot({path:path.join(output,'redesign-dialog.png')});
  await app.evaluate(()=>{process.env.SPINE_FAKE_CODEX_MODE='fail';});
  await page.getByRole('button',{name:'开始重新设计',exact:true}).click();await finish('failed');
  assert.equal(await frame('森林守卫'),before,'Failed redraw preserves visible skin');
  await app.evaluate(()=>{delete process.env.SPINE_FAKE_CODEX_MODE;});
  await page.getByRole('button',{name:'重新设计皮肤',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.skin-dialog textarea')?.disabled);
  await page.getByLabel('重新设计基础').selectOption('森林守卫');
  await page.getByLabel('新的设计要求').fill('修正眼睛、盾牌；保留绿甲和动作');
  await page.getByRole('button',{name:'开始重新设计',exact:true}).click();await finish('completed');
  let state=await page.evaluate(()=>window.shelf.getLibrary());
  assert.deepEqual(state.assets[0].skins,['default','森林守卫','寒冰守卫']);
  assert.equal(state.projects[0].members[0].skin,'森林守卫');
  assert.equal((await page.evaluate(id=>window.shelf.reskinList(id),asset.id))[0].replaceSkin,'森林守卫');
  assert.ok(await frame('森林守卫')!==before,'Redesign must change visible skin');
  assert.ok(await frame('寒冰守卫')===child,'Child retains its own pixels after base redesign');
  assert.ok(await frame('default')===original,'Native skin remains identical');
  await frame('森林守卫');
  await page.screenshot({path:path.join(output,'preview-actions.png')});
  await page.getByRole('button',{name:'资源信息',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'重新设计 森林守卫',exact:true}).count(),1);
  await page.getByRole('button',{name:'删除皮肤 森林守卫',exact:true}).click();
  await page.getByText(/项目「皮肤测试」/).waitFor();
  await page.getByText(/1 个新增皮肤会保留/).waitFor();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  state=await page.evaluate(()=>window.shelf.getLibrary());assert.equal(state.assets[0].reskins.length,2);
  await frame('森林守卫');await page.getByRole('button',{name:'删除皮肤',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.skin-dialog .danger-button')?.disabled);
  await page.screenshot({path:path.join(output,'delete-dialog.png')});
  await page.getByRole('button',{name:'确认删除皮肤',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('select[aria-label="皮肤"]')?.value==='default' && document.querySelector('.ready-dot')?.textContent==='已就绪');
  state=await page.evaluate(()=>window.shelf.getLibrary());
  assert.deepEqual(state.assets[0].skins,['default','寒冰守卫']);assert.equal(state.projects[0].members[0].skin,'default');
  assert.equal(await frame('寒冰守卫'),child,'Child retains its own pixels after base deletion');
  assert.equal(await frame('default'),original);
  await page.reload();await page.getByRole('button',{name:'预览 spineboy-pro',exact:true}).click();
  assert.equal(await frame('寒冰守卫'),child);
  await page.getByRole('button',{name:'资源信息',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'删除皮肤 森林守卫',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'management-after-delete.png')});
  // Actual default export must still merge the surviving child's skin chain.
  const reloaded=new Library(library.root);await reloaded.init();
  await new ProjectService(reloaded).export(projectId,path.join(output,'surviving-skins.zip'));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,realImageGeneration:false,skins:state.assets[0].skins,projectSkin:state.projects[0].members[0].skin},null,2));
  console.log('PASS: redesign failure/success through UI → worker fixture → scoped MCP; deletion, references, native/child pixel equality, reload and export');
} catch(error) {
  if(page) {
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),library:await page.evaluate(()=>window.shelf.getLibrary()),jobs:await page.evaluate(id=>window.shelf.reskinList(id),asset.id)},null,2));
  }
  throw error;
} finally {
  if(app)await app.close();
  await fs.rm(data,{recursive:true,force:true});
}
