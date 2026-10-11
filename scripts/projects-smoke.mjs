import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import yauzl from 'yauzl';
const require=createRequire(import.meta.url);
const {Library}=require('../electron/library.cjs');
const {ReskinService}=require('../electron/reskin.cjs');
const data=await fs.mkdtemp(path.join(os.tmpdir(),'spine-projects-ui-'));
const out=path.resolve('test-results/projects');await fs.mkdir(out,{recursive:true});
const library=new Library(path.join(data,'Library'));await library.init();
await library.importPaths([path.resolve('resources/examples/spineboy'),path.resolve('resources/examples/alien')]);
library.data.seeded=true;await library.save();
const hero=library.data.assets.find(a=>a.name==='spineboy-pro');
const reskins=new ReskinService(library);await reskins.init();
const {job}=await reskins.create({assetId:hero.id,name:'导出测试皮肤',baseSkin:hero.skins[0],prompt:'Synthetic fixture, no model call'});
const context=await reskins.context(job.id);
for(const p of context.pages){const png=PNG.sync.read(await fs.readFile(p.result));for(let i=0;i<png.data.length;i+=4){png.data[i]=Math.round(png.data[i]*.15);png.data[i+1]=Math.round(png.data[i+1]*.6);}await fs.writeFile(p.result,PNG.sync.write(png));}
await reskins.apply(job.id);
const env={...process.env,SPINE_SHELF_TEST:'1',SPINE_SHELF_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const executablePath=process.env.SPINE_TEST_APP;
const launch=()=>electron.launch({...executablePath?{executablePath,args:[]}:{args:['.']},env,cwd:process.cwd()});
const zipPath=path.join(out,'森林冒险.zip');
let app, page;
async function exportedManifest(file) {
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(err,zip)=>{
    if(err)return reject(err);zip.on('error',reject);zip.on('end',()=>reject(new Error('Missing export manifest')));
    zip.on('entry',entry=>{
      if(!entry.fileName.endsWith('/project.json'))return zip.readEntry();
      zip.openReadStream(entry,(err,stream)=>{
        if(err){zip.close();return reject(err);}const chunks=[];stream.on('error',reject);stream.on('data',b=>chunks.push(b));
        stream.on('end',()=>{zip.close();try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch(e){reject(e);}});
      });
    });zip.readEntry();
  }));
}
async function frame(page){
  await page.getByRole('button',{name:'动画预览',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ready-dot')?.textContent==='已就绪');
  await page.getByLabel('动画',{exact:true}).selectOption('walk');
  const pause=page.getByRole('button',{name:'暂停',exact:true});if(await pause.count())await pause.click();
  await page.locator('[data-tooltip="将播放进度回到第一帧"]').click();
  await page.locator('[data-tooltip="适应画布：居中并重置缩放（F）"]').click();
  await page.waitForTimeout(150);
  return page.locator('.stage canvas').evaluate(c=>c.toDataURL());
}
try {
  app=await launch();page=await app.firstWindow();
  await page.locator('.asset-card').first().waitFor();
  await page.getByRole('button',{name:'新建项目',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill('森林冒险');
  await page.getByLabel('项目备注',{exact:true}).fill('主角、地形和关卡素材');
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('button',{name:'从资源库添加',exact:true}).click();
  await page.getByLabel('添加 spineboy-pro',{exact:true}).check();
  await page.getByLabel('添加 alien-pro',{exact:true}).check();
  await page.getByRole('button',{name:'添加 2 份素材',exact:true}).click();
  await page.getByRole('button',{name:'项目设置 alien-pro',exact:true}).click();
  await page.getByLabel('项目分类',{exact:true}).selectOption('terrain');
  await page.getByRole('button',{name:'保存素材设置',exact:true}).click();
  await page.getByRole('button',{name:'项目设置 spineboy-pro',exact:true}).click();
  await page.getByLabel('项目内名称',{exact:true}).fill('主角弓手');
  await page.getByLabel('项目导出皮肤',{exact:true}).selectOption('导出测试皮肤');
  await page.getByRole('button',{name:'保存素材设置',exact:true}).click();
  await page.getByRole('button',{name:'项目设置',exact:true}).click();
  await page.getByLabel('新分类名称',{exact:true}).fill('怪物');
  await page.getByRole('button',{name:'添加分类',exact:true}).click();
  await page.getByLabel('分类名称 怪物',{exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭项目弹窗',exact:true}).click();
  const filter=page.getByRole('group',{name:'项目分类筛选'});
  await filter.getByRole('button',{name:/^地形/}).click();assert.equal(await page.locator('.asset-card').count(),1);
  await filter.getByRole('button',{name:/^全部/}).click();assert.equal(await page.locator('.asset-card').count(),2);
  await page.getByRole('separator').focus();await page.keyboard.press('End');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const compact=await page.locator('.main').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  assert.ok(compact.scroll<=compact.width+1,`Project layout overflow: ${JSON.stringify(compact)}`);
  await page.getByRole('separator').dblclick();
  await page.getByRole('button',{name:'预览 spineboy-pro',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="皮肤"]')?.value==='导出测试皮肤');
  const before=await frame(page);
  await page.getByLabel('皮肤',{exact:true}).selectOption('default');const originalBefore=await frame(page);
  await page.getByLabel('皮肤',{exact:true}).selectOption('导出测试皮肤');
  await page.screenshot({path:path.join(out,'project.png')});
  await app.evaluate(({dialog,shell},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});shell.showItemInFolder=()=>{};},zipPath);
  await page.getByRole('button',{name:'导出项目',exact:true}).click();
  await page.getByRole('table',{name:'素材版本检查'}).waitFor();
  await page.getByLabel('目标 Spine 版本').selectOption('3.8');
  await page.getByText(/4.2 → 3.8 属于降级/).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'选择位置并导出',exact:true}).isEnabled(),false);
  await page.getByLabel('目标 Spine 版本').selectOption('4.2');
  await page.getByText('已匹配 Spine 4.2，保留原数据').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('.project-dialog-export .modal-actions button')?.disabled);
  await page.screenshot({path:path.join(out,'export-dialog.png')});
  await page.getByRole('button',{name:'选择位置并导出',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.ok((await fs.stat(zipPath)).size>1000);
  const extract=path.join(data,'exported');await fs.mkdir(extract);
  await new Promise((resolve,reject)=>yauzl.open(zipPath,{lazyEntries:true},(err,zip)=>{
    if(err)return reject(err);zip.on('error',reject);zip.on('end',resolve);zip.on('entry',entry=>zip.openReadStream(entry,(err,stream)=>{
      if(err)return reject(err);const parts=[];stream.on('error',reject);stream.on('data',b=>parts.push(b));stream.on('end',async()=>{
        try{const target=path.resolve(extract,entry.fileName);assert.ok(target.startsWith(extract+path.sep));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.concat(parts));zip.readEntry();}catch(e){reject(e);}
      });
    }));zip.readEntry();
  }));
  const manifest=JSON.parse(await fs.readFile(path.join(extract,'森林冒险/project.json'),'utf8'));
  assert.equal(manifest.assets.length,2);const exportedHero=manifest.assets.find(a=>a.id===hero.id);
  assert.equal(exportedHero.bakedSkin,false);assert.equal(exportedHero.skinMode,'switchable');assert.deepEqual(exportedHero.skins,['default','导出测试皮肤']);
  assert.equal(exportedHero.runtimeSkin,'导出测试皮肤');assert.equal(exportedHero.textures.length,2);
  assert.equal(manifest.targetVersion,'4.2');assert.ok(manifest.assets.every(a=>a.runtimeVersion==='4.2' && !a.converted));
  // Export only the chosen member through the actual dialog and IPC, then inspect its ZIP.
  const selectedZip=path.join(out,'森林冒险-按需.zip');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},selectedZip);
  await page.getByRole('button',{name:'导出项目',exact:true}).click();
  await page.getByRole('radio',{name:/按需导出/}).check();
  await page.getByText('本次导出 0 / 2 份素材',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'选择位置并导出',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'全选',exact:true}).click();
  await page.getByLabel('导出 alien-pro',{exact:true}).uncheck();
  await page.getByRole('radio',{name:/全部导出/}).check();
  await page.getByText('本次导出 2 / 2 份素材',{exact:true}).waitFor();
  await page.getByRole('radio',{name:/按需导出/}).check();
  assert.equal(await page.getByLabel('导出 主角弓手',{exact:true}).isChecked(),true);
  assert.equal(await page.getByLabel('导出 alien-pro',{exact:true}).isChecked(),false);
  await page.getByLabel('搜索导出素材').fill('地形');
  await page.getByRole('button',{name:'全选搜索结果',exact:true}).click();
  await page.getByText('本次导出 2 / 2 份素材',{exact:true}).waitFor();
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  await page.getByText('本次导出 0 / 2 份素材',{exact:true}).waitFor();
  await page.getByLabel('搜索导出素材').fill('主角');
  await page.getByRole('button',{name:'全选搜索结果',exact:true}).click();
  await page.getByLabel('搜索导出素材').fill('');
  await page.getByText('本次导出 1 / 2 份素材',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.project-dialog-export .modal-actions button')?.disabled);
  if(await page.getByLabel('关闭提示',{exact:true}).count())await page.getByLabel('关闭提示',{exact:true}).click();
  const footer=await page.getByRole('button',{name:'选择位置并导出',exact:true}).boundingBox();
  const dialogBounds=await page.getByRole('dialog').boundingBox();
  assert.ok(footer && dialogBounds && footer.y>=dialogBounds.y && footer.y+footer.height<=dialogBounds.y+dialogBounds.height,'Export action stays visible while selecting');
  await page.screenshot({path:path.join(out,'selective-export-dialog.png')});
  await page.getByRole('button',{name:'选择位置并导出',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const selectedManifest=await exportedManifest(selectedZip);
  assert.deepEqual(selectedManifest.assets.map(a=>a.id),[hero.id]);assert.equal(selectedManifest.assets[0].bakedSkin,false);
  assert.equal(selectedManifest.categories.find(c=>c.id==='terrain').count,0);
  const current=await page.evaluate(()=>window.shelf.getLibrary());assert.equal(current.assets.length,2);assert.equal(current.projects[0].members.length,2);
  const imported=await page.evaluate(p=>window.shelf.importPaths([p]),extract);assert.deepEqual(imported.errors,[]);assert.equal(imported.added.length,2);
  const baked=imported.library.assets.find(a=>a.id===imported.added.find(id=>imported.library.assets.find(a=>a.id===id)?.animations.includes('walk')));
  assert.ok(baked);await page.evaluate(id=>window.shelf.update(id,{name:'导出验证'}),baked.id);
  await page.reload();await page.getByLabel('搜索资源').fill('导出验证');
  await page.getByRole('button',{name:'预览 导出验证',exact:true}).click();
  const after=await frame(page);
  assert.deepEqual(await page.getByLabel('皮肤',{exact:true}).locator('option').allTextContents(),['default','导出测试皮肤']);
  await page.getByLabel('皮肤',{exact:true}).selectOption('default');const originalAfter=await frame(page);
  assert.equal(originalAfter,originalBefore,'Original skin survives multi-skin export unchanged');
  await page.getByLabel('皮肤',{exact:true}).selectOption('导出测试皮肤');
  const a=PNG.sync.read(Buffer.from(before.split(',')[1],'base64')),b=PNG.sync.read(Buffer.from(after.split(',')[1],'base64'));
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let changed=0;for(let i=0;i<a.data.length;i++)if(Math.abs(a.data[i]-b.data[i])>2)changed++;
  assert.ok(changed<20,`Exported skin changed ${changed} channels`);
  await page.screenshot({path:path.join(out,'export-reimport.png')});
  await app.close();app=await launch();page=await app.firstWindow();
  await page.getByRole('button',{name:'项目：森林冒险',exact:true}).click();
  assert.equal(await page.locator('.asset-card').count(),2);
  await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('第二项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('button',{name:/^全部资源/}).click();await page.getByRole('button',{name:'批量选择',exact:true}).click();
  await page.getByLabel('选择 spineboy-pro',{exact:true}).check();
  await page.locator('.project-batch-bar').getByRole('button',{name:'加入项目',exact:true}).click();
  const updated=await page.evaluate(()=>window.shelf.getLibrary());await page.getByLabel('目标项目',{exact:true}).selectOption(updated.projects[1].id);
  await page.getByRole('dialog').getByRole('button',{name:'加入项目',exact:true}).click();
  await page.getByRole('button',{name:'项目：第二项目',exact:true}).click();await page.getByRole('button',{name:'移出项目 spineboy-pro',exact:true}).click();
  const final=await page.evaluate(()=>window.shelf.getLibrary());assert.equal(final.projects[0].members.length,2);assert.equal(final.projects[1].members.length,0);assert.equal(final.assets.length,4);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,packaged:!!executablePath,assets:2,selectiveExportAssets:selectedManifest.assets.length,projects:2,exportedSkinPixelDifferences:changed,categories:manifest.categories,restartPreserved:true},null,2));
  console.log('PASS: project UI, all/selective export with search and selection, selected AI skin ZIP → reimport identical pixels, restart, shared assets and independent removal.');
} catch(error) {
  if(page && !page.isClosed()) {
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(out,'failure.html'),await page.content()).catch(()=>{});
  }
  throw error;
} finally {if(app)await app.close();await fs.rm(data,{recursive:true,force:true});}
