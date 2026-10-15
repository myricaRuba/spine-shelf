import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Library}=require('../electron/library.cjs');
const data=await fs.mkdtemp(path.join(os.tmpdir(),'spine-project-import-'));
const output=path.resolve('test-results/project-import');await fs.mkdir(output,{recursive:true});
const library=new Library(path.join(data,'Library'));await library.init();
await library.importPaths([path.resolve('resources/examples/spineboy')]);library.data.seeded=true;await library.save();
const bad=path.join(data,'bad');await fs.mkdir(bad);
await fs.writeFile(path.join(bad,'broken.json'),JSON.stringify({skeleton:{spine:'4.2.22'},bones:[{name:'root'}]}));
const env={...process.env,SPINE_SHELF_DATA:data,SPINE_SHELF_TEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
let app,page;
const state=()=>page.evaluate(()=>window.shelf.getLibrary());
async function createProject(name) {
  await page.getByRole('button',{name:'新建项目',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill(name);
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('heading',{name:new RegExp(`^${name}`)}).waitFor();
}
async function selection(paths,canceled=false) {
  await app.evaluate(({dialog},value)=>{
    dialog.showOpenDialog=async(_window,options)=>{
      globalThis.lastImportDialog=options;
      return {canceled:value.canceled,filePaths:value.paths};
    };
  },{paths,canceled});
}
async function chooseFolder() {
  await page.getByRole('button',{name:/选择文件夹，或直接拖到这里/}).click();
}
try {
  app=await electron.launch({args:['.'],env,cwd:process.cwd()});page=await app.firstWindow();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.asset-card').first().waitFor();
  await createProject('森林冒险');
  assert.equal(await page.getByRole('button',{name:'导入本地资源',exact:true}).count(),1);
  await page.screenshot({path:path.join(output,'empty-project.png')});
  await page.getByRole('button',{name:'导入资源',exact:true}).click();
  await page.getByRole('heading',{name:'导入资源到「森林冒险」',exact:true}).waitFor();
  await selection([],true);await chooseFolder();
  assert.equal((await state()).projects[0].members.length,0);
  await page.getByRole('button',{name:/选择文件夹，或直接拖到这里/}).waitFor();
  await selection([path.resolve('resources/examples/alien'),path.resolve('resources/examples/spineboy'),bad]);
  await chooseFolder();
  await page.getByText('已加入项目 2 份素材',{exact:true}).waitFor();
  assert.equal(await page.locator('.import-errors b').innerText(),'broken.json');
  const options=await app.evaluate(()=>globalThis.lastImportDialog);
  assert.deepEqual(options.properties,['openDirectory','multiSelections']);assert.match(options.title,/森林冒险/);
  assert.equal(await page.locator('.import-summary > div').nth(0).locator('b').innerText(),'1');
  assert.equal(await page.locator('.import-summary > div').nth(1).locator('b').innerText(),'1');
  await page.screenshot({path:path.join(output,'import-report.png')});
  await page.getByRole('button',{name:'查看项目',exact:true}).click();
  assert.equal(await page.locator('.asset-card').count(),2);
  let current=await state();const projectId=current.projects[0].id, hero=current.assets.find(a=>a.name==='spineboy-pro');
  assert.equal(current.assets.length,2);assert.equal(current.projects[0].members.length,2);
  await page.evaluate(({projectId,id})=>window.shelf.projectMutate('member',{projectId,assetId:id,categoryId:'props',skin:'default',label:'自定义英雄',note:'保留'}),{projectId,id:hero.id});
  // Shortcut opens project import; successful reuse clears filters to show imported members.
  await page.getByLabel('搜索资源').fill('没有匹配结果');
  await page.keyboard.press(process.platform==='darwin'?'Meta+o':'Control+o');
  await page.getByRole('heading',{name:'导入资源到「森林冒险」',exact:true}).waitFor();
  await selection([path.resolve('resources/examples/spineboy/spineboy-pro.json')]);
  await page.getByRole('button',{name:/也可以选择 JSON/}).click();
  await page.getByText('另有 1 份已在项目中，保留已有设置。',{exact:true}).waitFor();
  assert.deepEqual((await app.evaluate(()=>globalThis.lastImportDialog)).properties,['openFile','multiSelections']);
  await page.getByRole('button',{name:'查看项目',exact:true}).click();
  assert.equal(await page.getByLabel('搜索资源').inputValue(),'');assert.equal(await page.locator('.asset-card').count(),2);
  current=await state();assert.equal(current.assets.length,2);
  const member=current.projects[0].members.find(m=>m.assetId===hero.id);
  assert.equal(member.categoryId,'props');assert.equal(member.label,'自定义英雄');assert.equal(member.note,'保留');
  await createProject('第二个项目');
  await page.getByRole('button',{name:'从资源库添加',exact:true}).click();
  await page.getByRole('button',{name:'从本地导入新资源',exact:true}).click();
  await page.getByRole('heading',{name:'导入资源到「第二个项目」',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.getByLabel('关闭弹窗',{exact:true}).click();
  // Use a real Chromium file handle so Electron webUtils resolves its path.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='fixture-drop';input.hidden=true;document.body.append(input);});
  await page.locator('#fixture-drop').setInputFiles(path.resolve('resources/examples/spineboy/spineboy-pro.json'));
  await page.evaluate(()=>{
    const input=document.querySelector('#fixture-drop');const transfer=new DataTransfer();transfer.items.add(input.files[0]);
    document.querySelector('.app').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));input.remove();
  });
  await page.getByRole('heading',{name:'导入资源到「第二个项目」',exact:true}).waitFor();
  await page.getByText('已加入项目 1 份素材',{exact:true}).waitFor();
  await page.getByRole('button',{name:'查看项目',exact:true}).click();
  current=await state();assert.equal(current.assets.length,2);assert.equal(current.projects[0].members.length,2);assert.equal(current.projects[1].members.length,1);
  await page.getByRole('separator').focus();await page.keyboard.press('End');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const bounds=await page.locator('.main').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  assert.ok(bounds.scroll<=bounds.width+1,`Project heading overflow: ${JSON.stringify(bounds)}`);
  await page.screenshot({path:path.join(output,'compact-project.png')});
  await page.getByRole('separator').dblclick();
  // Library import still only imports to the library.
  await page.getByRole('button',{name:/全部资源/}).click();
  await page.getByRole('button',{name:'导入资源',exact:true}).click();
  await page.getByRole('heading',{name:'把动画加入你的资源库',exact:true}).waitFor();
  await selection([path.resolve('resources/examples/raptor')]);await chooseFolder();
  await page.getByRole('button',{name:'查看资源库',exact:true}).click();
  current=await state();assert.equal(current.assets.length,3);assert.equal(current.projects[0].members.length,2);assert.equal(current.projects[1].members.length,1);
  await page.reload();await page.getByLabel('项目：森林冒险',{exact:true}).click();
  assert.equal(await page.locator('.asset-card').count(),2);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,'project-after-import.png')});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,assets:3,projects:current.projects.map(p=>({name:p.name,members:p.members.length})),checks:['folder','file','cancel','reuse','partial failure','shortcut','drop','picker entry','compact layout','library isolation','reload']},null,2));
  console.log('PASS: project import via folder/file dialogs, shortcut and real file drop; deduplication, partial errors, member preservation, isolation and persistence');
} catch(error) {
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  throw error;
} finally {if(app)await app.close();await fs.rm(data,{recursive:true,force:true});}
