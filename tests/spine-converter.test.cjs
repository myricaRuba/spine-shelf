const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {SpineConverter,exportAction,targetVersion,runProcess}=require('../electron/spine-converter.cjs');
const {validateConvertedSkeleton}=require('../electron/spine-export-validation.cjs');
const {Library}=require('../electron/library.cjs');
const {ProjectService}=require('../electron/projects.cjs');
const {PNG}=require('pngjs');
const yauzl=require('yauzl');

const atlas='page.png\nsize: 10,10\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n  xy: 0,0\n  size: 10,10\n  orig: 10,10\n  offset: 0,0\n  index: -1\n';
function skeleton(version='3.8.99') {
  return {skeleton:{spine:version},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'}],
    skins:[{name:'default',attachments:{body:{body:{type:'mesh',uvs:[0,0,1,0,1,1,0,1],triangles:[0,1,2,2,3,0],vertices:[0,0,10,0,10,10,0,10],hull:4,width:10,height:10}}}}],animations:{idle:{}}};
}
async function work(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spine-converter-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function fakeConverter(t,{version='4.2.22', mutate, fail=false}={}) {
  const root=await work(t),exe=path.join(root,'Spine command.com');await fs.writeFile(exe,'fixture');
  const calls=[];
  const converter=new SpineConverter({executable:exe,platform:'win32',run:async(file,args)=>{
    calls.push(args);
    if(fail)throw new Error('fixture: editor cannot start');
    const output=args[args.indexOf('-o')+1];
    if(args.includes('--import')) await fs.writeFile(output,'intermediate project');
    else {const json=skeleton(version);mutate?.(json);await fs.writeFile(path.join(output,'skeleton.json'),JSON.stringify(json));}
    return 'Complete.';
  }});
  return {root,converter,calls};
}
async function project(t,converter,version='3.8.99') {
  const root=await work(t),input=path.join(root,'source');await fs.mkdir(input);
  await fs.writeFile(path.join(input,'skeleton.json'),JSON.stringify(skeleton(version)));
  await fs.writeFile(path.join(input,'skeleton.atlas'),atlas);
  const png=new PNG({width:10,height:10});png.data.fill(255);await fs.writeFile(path.join(input,'page.png'),PNG.sync.write(png));
  const library=new Library(path.join(root,'Library'));await library.init();
  const imported=await library.importPaths([input]);assert.deepEqual(imported.errors,[]);
  const service=new ProjectService(library,converter),asset=library.data.assets[0];
  const id=(await service.mutate('create',{name:'版本转换'})).projectId;await service.mutate('add',{projectId:id,assetIds:[asset.id]});
  return {root,library,service,asset,id};
}
async function unzip(file) {
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(err,zip)=>{
    if(err)return reject(err);const files=new Map();zip.on('error',reject);zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>zip.openReadStream(entry,(err,stream)=>{
      if(err)return reject(err);const chunks=[];stream.on('data',b=>chunks.push(b));stream.on('error',reject);stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});
    }));zip.readEntry();
  }));
}
test('export choices preserve matched versions, convert legacy 3.8 and reject downgrade or invalid targets',()=>{
  assert.equal(targetVersion(),'original');assert.throws(()=>targetVersion({targetVersion:'4.2; run'}),/目标版本/);
  assert.equal(exportAction('3.8.75','original').action,'copy');assert.equal(exportAction('3.8.75','3.8').action,'convert');
  assert.equal(exportAction('3.8.99','3.8').action,'copy');assert.equal(exportAction('4.1.19','4.2').action,'convert');
  assert.equal(exportAction('4.2.22','3.8').action,'blocked');assert.equal(exportAction('4.2-from-4.3.10','4.2').action,'blocked');
});
test('Spine.exe selection resolves adjacent CLI, validates help and persists across restart',async t=>{
  const root=await work(t),exe=path.join(root,'Spine.exe'),cli=path.join(root,'Spine.com'),settingsFile=path.join(root,'settings.json');
  await fs.writeFile(exe,'');await fs.writeFile(cli,'');
  const converter=new SpineConverter({settingsFile,platform:'win32',run:async()=> 'Spine --import --export --update'});
  await converter.configure(exe);const reloaded=new SpineConverter({settingsFile,platform:'win32'});await reloaded.init();
  assert.equal((await reloaded.status()).path,await fs.realpath(cli));assert.equal((await reloaded.status()).available,true);
});
test('conversion imports a private source copy with its editor and exports with the target editor',async t=>{
  const x=await fakeConverter(t),input=path.join(x.root,'source.json'),before=JSON.stringify(skeleton());await fs.writeFile(input,before);
  const result=await x.converter.convert({input,format:'json',version:'3.8.99',target:'4.2',directory:x.root});
  assert.equal(result.version,'4.2.22');assert.equal(result.format,'json');assert.equal(result.converted,true);
  assert.equal(x.calls[0][1],'3.8.99');assert.equal(x.calls[1][1],'4.2.xx');
  assert.notEqual(x.calls[0][3],input);assert.equal(await fs.readFile(input,'utf8'),before);
  assert.equal((await fs.readdir(x.root)).some(n=>n.startsWith('convert-')),false);
});
test('converter rejects outputs that only claim success, have wrong versions, or retain 3.8.75',async t=>{
  for(const version of ['4.1.19','4.2-from-4.3.1','3.8.75']) {
    const x=await fakeConverter(t,{version}),input=path.join(x.root,'source.json');await fs.writeFile(input,JSON.stringify(skeleton('3.8.75')));
    await assert.rejects(x.converter.convert({input,format:'json',version:'3.8.75',target:version==='3.8.75'?'3.8':'4.2',directory:x.root}),/版本不匹配/);
  }
});
test('legacy 3.8.75 imports through its original editor before re-exporting as 3.8.99',async t=>{
  const x=await fakeConverter(t,{version:'3.8.99'}),input=path.join(x.root,'source.json');await fs.writeFile(input,JSON.stringify(skeleton('3.8.75')));
  const result=await x.converter.convert({input,format:'json',version:'3.8.75',target:'3.8',directory:x.root});
  assert.equal(x.calls[0][1],'3.8.75');assert.equal(x.calls[1][1],'3.8.99');assert.equal(result.version,'3.8.99');
});
test('target runtimes load atlas meshes and sample converted output for each supported version',async()=>{
  for(const version of ['3.8.99','4.0.31','4.1.19','4.2.22','4.3.13']) {
    const result=await validateConvertedSkeleton({runtime:version.split('.').slice(0,2).join('.'),json:skeleton(version)},atlas,{bones:1,slots:1,animations:['idle']},'default');
    assert.deepEqual([...result.animations],['idle']);
  }
});
test('runtime validation rejects missing animations, skin and broken mesh references',async()=>{
  const asset={bones:1,slots:1,animations:['idle']};
  await assert.rejects(validateConvertedSkeleton({runtime:'4.2',json:skeleton('4.2.22')},atlas,{...asset,animations:['walk']},'default'),/丢失动画/);
  await assert.rejects(validateConvertedSkeleton({runtime:'4.2',json:skeleton('4.2.22')},atlas,asset,'missing'),/皮肤/);
  const json=skeleton('4.2.22');json.skins[0].attachments.body.body.path='missing';
  await assert.rejects(validateConvertedSkeleton({runtime:'4.2',json},atlas,asset,'default'),/missing/);
});
test('a selected version produces a validated ZIP with actual/source versions and unchanged source textures',async t=>{
  const x=await fakeConverter(t),p=await project(t,x.converter),destination=path.join(p.root,'converted.zip');
  const source=await fs.readFile(path.join(p.library.root,'assets',p.asset.id,'skeleton.json'));const progress=[];
  const result=await p.service.export(p.id,destination,event=>progress.push(event),{targetVersion:'4.2'});
  assert.equal(result.converted,1);assert.ok(progress.some(p=>p.phase==='converting'));
  const files=await unzip(destination),manifest=JSON.parse(files.get('版本转换/project.json')),item=manifest.assets[0];
  assert.equal(manifest.targetVersion,'4.2');assert.equal(item.spineVersion,'4.2.22');assert.equal(item.sourceSpineVersion,'3.8.99');assert.equal(item.converted,true);
  assert.equal(JSON.parse(files.get('版本转换/'+item.skeleton)).skeleton.spine,'4.2.22');
  assert.deepEqual(files.get('版本转换/'+item.textures[0]),await fs.readFile(path.join(p.library.root,'assets',p.asset.id,'textures/0.png')));
  assert.deepEqual(await fs.readFile(path.join(p.library.root,'assets',p.asset.id,'skeleton.json')),source);
});
test('missing editor, downgrade, invalid output and CLI failure cannot replace an existing ZIP',async t=>{
  for(const mode of ['missing','downgrade','invalid','failed']) {
    const x=await fakeConverter(t,{fail:mode==='failed',mutate:mode==='invalid'?json=>{json.animations={};}:undefined});
    if(mode==='missing') x.converter.executable=path.join(x.root,'not-found.com');
    const p=await project(t,x.converter,mode==='downgrade'?'4.2.22':'3.8.99'),destination=path.join(p.root,'keep.zip');await fs.writeFile(destination,'keep');
    await assert.rejects(p.service.export(p.id,destination,()=>{},{targetVersion:mode==='downgrade'?'3.8':'4.2'}));
    assert.equal(await fs.readFile(destination,'utf8'),'keep');
  }
});
test('same minor version exports without calling an editor, while real file version overrides stale library metadata',async t=>{
  const p=await project(t,{status:async()=>({available:false,message:'no editor'}),convert:()=>{throw Error('must not convert');}});
  p.asset.version='4.3.1';const plan=await p.service.exportPlan(p.id,{targetVersion:'3.8'});
  assert.equal(plan.assets[0].version,'3.8.99');assert.equal(plan.canExport,true);
  const result=await p.service.export(p.id,path.join(p.root,'same.zip'),()=>{},{targetVersion:'3.8'});assert.equal(result.converted,0);
});
test('command timeout ends a stuck converter and launcher errors are explained without raw stacks',async()=>{
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:150}),/超时/);
  await assert.rejects(runProcess(process.execPath,['-e',"console.error('java.lang.IllegalArgumentException: Version cannot be null.');process.exit(1)"]),/未能加载/);
});
test('binary skin merging requests JSON from the exact original editor instead of pretending to convert the binary',async t=>{
  const x=await fakeConverter(t,{version:'4.2.22'}),input=path.join(x.root,'source.skel');await fs.writeFile(input,'binary fixture');
  const result=await x.converter.convert({input,format:'skel',version:'4.2.22',target:'original',directory:x.root,forceJson:true});
  assert.equal(x.calls[0][1],'4.2.22');assert.equal(x.calls[1][1],'4.2.22');assert.equal(result.runtime,'4.2');assert.equal(result.format,'json');
  const p=await project(t,{status:async()=>({available:false,message:'no editor'})},'4.2.22');
  p.asset.format='skel';p.asset.reskins=[{name:'new',baseSkin:'default',atlas:'new.atlas'}];p.asset.skins.push('new');
  await fs.writeFile(path.join(p.library.root,'assets',p.asset.id,'skeleton.skel'),Buffer.concat([Buffer.alloc(8),Buffer.from([7]),Buffer.from('4.2.22')]));
  const plan=await p.service.exportPlan(p.id,{skinMode:'switchable'});assert.equal(plan.canExport,false);assert.equal(plan.assets[0].forceJson,true);
  assert.equal((await p.service.exportPlan(p.id,{skinMode:'current'})).canExport,true);
});
