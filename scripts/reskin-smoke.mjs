import { _electron as electron } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const root = process.cwd();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-reskin-ui-'));
const output = path.resolve('test-results/reskin');
await fs.mkdir(output, {recursive:true});
const env = {...process.env, SPINE_SHELF_DATA:dataDir, SPINE_SHELF_TEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const appPath = process.env.SPINE_TEST_APP;
const launch = () => electron.launch({ ...(appPath ? {executablePath:appPath,args:[]} : {args:['.']}), cwd:root, env });
let app, client;
async function call(name, args={}) {
  const result = await client.callTool({name:`spine_reskin_${name}`,arguments:args});
  assert.ok(!result.isError, JSON.stringify(result.content));
  return result.structuredContent;
}
async function ready(page) {
  await page.waitForFunction(() => ['已就绪','加载失败'].includes(document.querySelector('.ready-dot')?.textContent));
  assert.equal(await page.locator('.stage-message.error').count(),0, await page.locator('.stage-message.error').allTextContents());
}
async function pixels(page, fraction=0) {
  const pause = page.getByRole('button',{name:'暂停',exact:true});
  if (await pause.count()) await pause.click();
  await page.locator('[data-tooltip="将播放进度回到第一帧"]').click();
  if (fraction) await page.getByLabel('播放进度').evaluate((input,f) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(Number(input.max)*f));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },fraction);
  await page.locator('[data-tooltip="适应画布：居中并重置缩放（F）"]').click();
  await page.waitForTimeout(100);
  return page.locator('.stage canvas').evaluate(c => c.toDataURL());
}
function changed(a,b) {
  const x=PNG.sync.read(Buffer.from(a.split(',')[1],'base64'));
  const y=PNG.sync.read(Buffer.from(b.split(',')[1],'base64'));
  assert.equal(x.data.length,y.data.length);
  let n=0; for(let i=0;i<x.data.length;i+=4) if (Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>30) n++;
  return n;
}
function silhouette(a,b,label) {
  const x=PNG.sync.read(Buffer.from(a.split(',')[1],'base64'));
  const y=PNG.sync.read(Buffer.from(b.split(',')[1],'base64'));
  assert.equal(x.data.length,y.data.length);
  let difference=0;for(let i=3;i<x.data.length;i+=4) if(Math.abs(x.data[i]-y.data[i])>2) difference++;
  assert.equal(difference,0,`${label}: skin changed animation geometry`);
}
try {
  app = await launch();
  let page = await app.firstWindow();
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
  await page.waitForSelector('.asset-card');
  const paths=[path.resolve('test-results/fixtures')];
  const personal=path.resolve('artifacts/reskins/p0016-two-skins/export');
  if (await fs.stat(personal).catch(()=>null)) paths.push(personal);
  const imported=await page.evaluate(p=>window.shelf.importPaths(p),paths);
  assert.deepEqual(imported.errors,[]);
  const onlyRuntime=process.env.SPINE_TEST_RUNTIME;
  const cases=imported.library.assets.filter(a=>(a.name==='spineboy-pro' || a.name.startsWith('p0016')) && (!onlyRuntime || a.runtime===onlyRuntime));
  assert.ok(cases.length >= (onlyRuntime ? 2 : 10));
  for(const a of cases) await page.evaluate(a=>window.shelf.update(a.id,{name:`reskin-${a.runtime}-${a.format}-${a.name}`}),a);
  await page.reload(); await page.waitForSelector('.asset-card');
  client=new Client({name:'spine-reskin-e2e',version:'1.0.0'});
  const transport=new StdioClientTransport({command:appPath||process.execPath,args:[appPath ? path.resolve(path.dirname(appPath),'../Resources/app.asar/electron/mcp-server.cjs') : path.resolve('electron/mcp-server.cjs'),'--data-dir',dataDir],env:appPath?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:undefined,stderr:'pipe'});
  await client.connect(transport);
  const tools=(await client.listTools()).tools;
  assert.equal(tools.filter(tool=>tool.name.startsWith('spine_reskin_')).length,7);
  assert.equal(tools.filter(tool=>tool.name.startsWith('spine_generate_')).length,7);
  const count=(await call('status')).assets;
  const evidence=[];
  for(let i=0;i<cases.length;i++) {
    const a=cases[i]; const name=`reskin-${a.runtime}-${a.format}-${a.name}`;
    console.log('RESKIN START',name);
    await page.getByRole('button',{name:`预览 ${name}`,exact:true}).click(); await ready(page);
    const skins=page.getByLabel('皮肤',{exact:true});
    const original=await skins.inputValue();
    const before=await pixels(page);
    const skeleton=path.join(dataDir,'Library/assets',a.id,`skeleton.${a.format}`);
    const hash=crypto.createHash('sha256').update(await fs.readFile(skeleton)).digest('hex');
    const newSkin=`MCP验证-${a.runtime}-${a.format}`;
    const job=(await call('create_task',{assetId:a.id,name:newSkin,prompt:'临时自动化验证',baseSkin:original})).job;
    const context=await call('get_task',{taskId:job.id});
    await call('update_task',{taskId:job.id,status:'processing',message:'正在验证贴图与动画'});
    // Synthetic fixture change only. Production artwork is generated by Codex.
    for(const p of context.pages) {
      const png=PNG.sync.read(await fs.readFile(p.result));
      for(let n=0;n<png.data.length;n+=4) {png.data[n]=Math.round(png.data[n]*0.25);png.data[n+1]=Math.round(png.data[n+1]*0.4);}
      await fs.writeFile(p.result,PNG.sync.write(png));
    }
    const applied=await call('apply',{taskId:job.id});
    assert.equal(applied.asset.id,a.id);
    await page.waitForFunction(n=>Array.from(document.querySelectorAll('select[aria-label="皮肤"] option')).some(o=>o.value===n) || document.querySelector('.ready-dot')?.textContent==='加载失败',newSkin);
    await ready(page);
    // The viewer preserves the current skin when the asset refreshes.
    await skins.selectOption(newSkin);
    const after=await pixels(page); const countChanged=changed(before,after);
    silhouette(before,after,name);
    assert.ok(countChanged>100,`${name}: skin pixels did not change (${countChanged})`);
    await skins.selectOption(original); const restored=await pixels(page);
    if(changed(before,restored)) for(const [label,value] of Object.entries({before,after,restored})) await fs.writeFile(path.join(output,`${label}.png`),Buffer.from(value.split(',')[1],'base64'));
    assert.equal(changed(before,restored),0,`${name}: original skin changed`);
    await skins.selectOption(newSkin);
    const animations=await page.getByLabel('动画',{exact:true}).locator('option').evaluateAll(els=>els.map(e=>e.value));
    for(const animation of animations) {
      await page.getByLabel('动画',{exact:true}).selectOption(animation);
      for (const fraction of [0,0.5,0.99]) {
        await skins.selectOption(original);const oldFrame=await pixels(page,fraction);
        await skins.selectOption(newSkin);const newFrame=await pixels(page,fraction);
        silhouette(oldFrame,newFrame,`${name}/${animation}@${fraction}`);
      }
    }
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(skeleton)).digest('hex'),hash);
    assert.equal((await call('status')).assets,count);
    evidence.push({runtime:a.runtime,format:a.format,source:a.name,animations:animations.length,changedPixels:countChanged,assetId:a.id});
    console.log('RESKIN PASS',name,animations.length,'animations',countChanged,'changed pixels');
  }
  await page.screenshot({path:path.join(output,'completed.png')});
  assert.deepEqual(pageErrors,[]);
  await client.close();client=null;
  await app.close();app=await launch();page=await app.firstWindow();await page.waitForSelector('.asset-card');
  const lib=await page.evaluate(()=>window.shelf.getLibrary());
  assert.equal(lib.assets.length,count);
  for(const a of cases) assert.equal(lib.assets.find(x=>x.id===a.id).reskins.length,1);
  const last=cases.at(-1);
  await page.getByRole('button',{name:`预览 reskin-${last.runtime}-${last.format}-${last.name}`,exact:true}).click();await ready(page);
  assert.match(await page.getByLabel('皮肤',{exact:true}).inputValue(),/^MCP验证/);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,packaged:!!appPath,cases:evidence},null,2));
  console.log('PASS: UI → MCP → same-resource native skins, original pixels preserved, restart persisted');
} finally {
  if(client) await client.close().catch(()=>{});
  if(app) await app.close().catch(()=>{});
  await fs.rm(dataDir,{recursive:true,force:true});
}
