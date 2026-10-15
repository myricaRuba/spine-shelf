const fs = require('node:fs/promises');
const {createWriteStream} = require('node:fs');
const {pipeline} = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID,createHash} = require('node:crypto');
const {ZipFile} = require('yazl');
const {detectVersion} = require('./library.cjs');
const {safeFile} = require('./reskin.cjs');
const {SpineConverter,targetVersion,exportAction} = require('./spine-converter.cjs');
const {validateConvertedSkeleton} = require('./spine-export-validation.cjs');
const {skinMode,nativeSkin,prepareSkinExport} = require('./spine-skin-export.cjs');

const DEFAULT_CATEGORIES = [
  {id:'character',name:'人物'}, {id:'terrain',name:'地形'}, {id:'props',name:'道具'},
  {id:'effects',name:'特效'}, {id:'ui',name:'界面'}, {id:'other',name:'其他'},
];
const check = (ok,message) => {if(!ok)throw new Error(message);};
function name(value,limit=60) {
  check(typeof value==='string' && value.trim().length>0 && value.trim().length<=limit,`名称需为 1–${limit} 个字。`);
  return value.trim();
}
function note(value='') {check(typeof value==='string' && value.length<=2000,'备注最多 2000 字。');return value.trim();}
function filename(value) {
  let result=String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'-').replace(/[. ]+$/g,'').slice(0,60);
  if(!result || /^\.+$/.test(result))result='未命名';
  if(/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(result))result='_'+result;
  return result;
}
function uniqueFolder(value,used) {
  let candidate=value,index=2;
  while(used.has(candidate.normalize('NFC').toLowerCase()))candidate=`${value}-${index++}`;
  used.add(candidate.normalize('NFC').toLowerCase());return candidate;
}
function defaultSkin(asset) {return asset.reskins?.at(-1)?.name || asset.skins.find(s=>s!=='default') || asset.skins[0] || 'default';}
function autoCategory(project,asset) {
  const id=({character:'character',scene:'terrain',material:'props'})[asset.category] || 'other';
  return project.categories.some(c=>c.id===id) ? id : 'other';
}
class ProjectService {
  constructor(library,converter=new SpineConverter()) {this.library=library;this.converter=converter;}
  project(id) {const p=this.library.data.projects.find(p=>p.id===id);check(p,'项目不存在。');return p;}
  async importPaths(id, paths) {
    const project = this.project(id);
    const members = new Set(project.members.map(m => m.assetId));
    const report = await this.library.importPaths(paths);
    const ids = [...new Set([...report.added, ...report.existingIds])];
    const added = ids.filter(assetId => !members.has(assetId));
    const projectImport = { id, name: project.name, added: [], existing: ids.filter(assetId => members.has(assetId)) };
    if (added.length) {
      try {
        await this.mutate('add', { projectId: id, assetIds: added });
        projectImport.added = added;
      } catch (e) {
        // Import is already durable. Report that partial success so a retry can
        // reuse the same library assets instead of losing them or duplicating them.
        projectImport.error = `素材已保存在资源库，但加入项目失败：${e.message}。请重试导入，软件会复用已有素材。`;
      }
    }
    return { ...report, projectImport, library: this.library.snapshot() };
  }
  async exportPlan(id,options={}) {
    const target=targetVersion(options),mode=skinMode(options),project=this.project(id);
    let members=project.members;
    if(options.assetIds!==undefined) {
      check(Array.isArray(options.assetIds) && options.assetIds.every(id=>typeof id==='string' && id.length>0),'导出素材选择无效。');
      const selected=new Set(options.assetIds),available=new Set(members.map(m=>m.assetId));
      check([...selected].every(id=>available.has(id)),'所选素材已不在此项目中，请重新选择。');
      members=members.filter(m=>selected.has(m.assetId));
    }
    const assets=[];
    for(const member of members) {
      const asset=this.library.asset(member.assetId),base=path.join(this.library.root,'assets',asset.id);
      const bytes=await fs.readFile(await safeFile(base,`skeleton.${asset.format}`));
      const version=detectVersion(bytes,asset.format==='json'?JSON.parse(bytes.toString('utf8')):null);
      const action=exportAction(version,target),forceJson=mode==='switchable' && asset.format==='skel' && !!asset.reskins?.length;
      if(forceJson && action.action==='copy')Object.assign(action,{action:'convert',message:'通过 Spine 将 SKEL 转为 JSON，再合并可切换皮肤'});
      assets.push({id:asset.id,name:member.label || asset.name,version,...action,forceJson,skins:mode==='switchable'?asset.skins:[member.skin]});
    }
    const converter=await this.converter.status();
    return {targetVersion:target,skinMode:mode,assets,converter,canExport:assets.length>0 && assets.every(a=>a.action!=='blocked') && (!assets.some(a=>a.action==='convert') || converter.available)};
  }
  async mutate(action,input={}) {
    const previous=structuredClone(this.library.data.projects);
    let selectedId=input.projectId;
    try {
      if(action==='create') {
        const title=name(input.name);
        check(!previous.some(p=>p.name.toLocaleLowerCase()===title.toLocaleLowerCase()),'已有同名项目。');
        const at=new Date().toISOString();
        const p={id:randomUUID(),name:title,note:note(input.note),createdAt:at,updatedAt:at,categories:structuredClone(DEFAULT_CATEGORIES),members:[]};
        this.library.data.projects.push(p);selectedId=p.id;
      } else {
        const p=this.project(input.projectId);
        if(action==='rename') {
          const title=name(input.name);
          check(!previous.some(x=>x.id!==p.id && x.name.toLocaleLowerCase()===title.toLocaleLowerCase()),'已有同名项目。');
          p.name=title;p.note=note(input.note);
        } else if(action==='remove') this.library.data.projects=this.library.data.projects.filter(x=>x.id!==p.id);
        else if(action==='category') {
          const title=name(input.name,30),id=input.categoryId || randomUUID();
          check(!p.categories.some(c=>c.id!==id && c.name.toLocaleLowerCase()===title.toLocaleLowerCase()),'已有同名分类。');
          if(input.categoryId) {const c=p.categories.find(c=>c.id===id);check(c,'分类不存在。');c.name=title;}
          else {check(p.categories.length<50,'每个项目最多 50 个分类。');p.categories.push({id,name:title});}
        } else if(action==='removeCategory') {
          check(input.categoryId!=='other','请保留其他分类，用于暂未归类的素材。');
          check(p.categories.some(c=>c.id===input.categoryId),'分类不存在。');
          check(!p.members.some(m=>m.categoryId===input.categoryId),'请先将该分类的素材移动到其他分类。');
          p.categories=p.categories.filter(c=>c.id!==input.categoryId);
        } else if(action==='add') {
          check(Array.isArray(input.assetIds) && input.assetIds.length>0 && input.assetIds.length<=5000,'请选择要加入的素材。');
          check(!input.categoryId || p.categories.some(c=>c.id===input.categoryId),'分类不存在。');
          for(const id of new Set(input.assetIds)) {
            const asset=this.library.asset(id);
            if(p.members.some(m=>m.assetId===id))continue;
            p.members.push({assetId:id,categoryId:input.categoryId || autoCategory(p,asset),skin:defaultSkin(asset),label:'',note:'',addedAt:new Date().toISOString()});
          }
        } else if(action==='member') {
          const m=p.members.find(m=>m.assetId===input.assetId),asset=this.library.asset(input.assetId);
          check(m,'该素材尚未加入项目。');check(p.categories.some(c=>c.id===input.categoryId),'分类不存在。');
          check(asset.skins.includes(input.skin),'所选皮肤已不存在，请重新选择。');
          Object.assign(m,{categoryId:input.categoryId,skin:input.skin,label:input.label ? name(input.label,60) : '',note:note(input.note)});
        } else if(action==='removeMembers') {
          check(Array.isArray(input.assetIds),'请选择要移出的素材。');
          p.members=p.members.filter(m=>!input.assetIds.includes(m.assetId));
        } else throw new Error('未知项目操作。');
        p.updatedAt=new Date().toISOString();
      }
      await this.library.save();
      return {library:this.library.snapshot(),projectId:selectedId};
    } catch(e) {this.library.data.projects=previous;throw e;}
  }
  async export(id,destination,progress=()=>{},options={}) {
    const project=structuredClone(this.project(id));
    check(project.members.length>0,'项目里还没有素材，请先从资源库添加。');
    const plan=await this.exportPlan(id,options);
    const selected=new Set(plan.assets.map(a=>a.id));
    project.members=project.members.filter(m=>selected.has(m.assetId));
    check(project.members.length>0,'请至少选择一份需要导出的素材。');
    check(!plan.assets.some(a=>a.action==='blocked'),plan.assets.filter(a=>a.action==='blocked').map(a=>`${a.name}：${a.message}`).join('\n'));
    check(plan.canExport,plan.converter.message);
    check(typeof destination==='string' && path.isAbsolute(destination) && /\.zip$/i.test(destination),'请选择 ZIP 保存位置。');
    const parent=await fs.realpath(path.dirname(destination));
    const libraryRoot=await fs.realpath(this.library.root);
    check(parent!==libraryRoot && !parent.startsWith(libraryRoot+path.sep),'请将导出包保存在资源库目录之外。');
    const work=await fs.mkdtemp(path.join(os.tmpdir(),'spine-project-'));
    const temporary=path.join(parent,`.spine-export-${randomUUID()}.tmp`);
    const entries=[],manifest={schemaVersion:1,name:project.name,note:project.note,targetVersion:plan.targetVersion,skinMode:plan.skinMode,exportedAt:new Date().toISOString(),categories:[],assets:[]};
    const rootName=filename(project.name);
    const add=async(relative,bytes)=> {
      const target=path.join(work,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
      entries.push({path:relative,file:target,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)});
    };
    try {
      const categoryFolders=new Set(),assetFolders=new Set();
      for(const c of project.categories) manifest.categories.push({...c,folder:uniqueFolder(`${filename(c.name)}-${filename(c.id.slice(0,8))}`,categoryFolders),count:project.members.filter(m=>m.categoryId===c.id).length});
      for(const [i,member] of project.members.entries()) {
        const asset=this.library.asset(member.assetId);
        check(asset.skins.includes(member.skin),`${asset.name} 的皮肤「${member.skin}」已不存在，请重新选择。`);
        const category=manifest.categories.find(c=>c.id===member.categoryId);check(category,`${asset.name} 缺少项目分类。`);
        const displayName=member.label || asset.name;
        const folder=uniqueFolder(`${category.folder}/${filename(displayName)}-${filename(asset.id.slice(0,8))}`,assetFolders);
        const base=path.join(this.library.root,'assets',asset.id);
        const runtimeSkin=nativeSkin(asset,member.skin);
        check(asset.skins.includes(runtimeSkin),`${asset.name} 的基础皮肤「${runtimeSkin}」已不存在，请修复素材。`);
        const input=await safeFile(base,`skeleton.${asset.format}`),planned=plan.assets.find(a=>a.id===asset.id);
        let output={bytes:await fs.readFile(input),format:asset.format,version:planned.version,runtime:/^(\d+\.\d+)\./.exec(planned.version)?.[1] || asset.runtime,converted:false};
        if(planned.action==='convert') {
          progress({completed:i,total:project.members.length,name:displayName,phase:'converting'});
          output=await this.converter.convert({input,format:asset.format,version:planned.version,target:plan.targetVersion,directory:work,forceJson:planned.forceJson});
        }
        const prepared=await prepareSkinExport({base,asset,output,selectedSkin:member.skin,mode:plan.skinMode});output=prepared.output;
        if(output.converted || prepared.merged)await validateConvertedSkeleton({...output,json:output.json || JSON.parse(output.bytes.toString('utf8'))},prepared.atlas,asset,prepared.runtimeSkin,{allSkins:plan.skinMode==='switchable'});
        const textures=[];
        for(const texture of prepared.textures) {const target=`${folder}/${texture.name}`;await add(target,texture.bytes);textures.push(target);}
        const skeleton=`${folder}/skeleton.${output.format}`,atlasPath=`${folder}/skeleton.atlas`;
        await add(skeleton,output.bytes);
        await add(atlasPath,prepared.atlas);
        const item={id:asset.id,name:displayName,categoryId:category.id,category:category.name,skin:member.skin,runtimeSkin:prepared.runtimeSkin,bakedSkin:prepared.bakedSkin,skinMode:plan.skinMode,skins:prepared.skins,
          spineVersion:output.version,runtimeVersion:output.runtime,format:output.format,sourceSpineVersion:planned.version,converted:output.converted,pma:asset.pma,animations:asset.animations,note:member.note,
          skeleton,atlas:atlasPath,textures};
        manifest.assets.push(item);
        await add(`${folder}/asset.json`,JSON.stringify({...item,skeleton:path.posix.basename(skeleton),atlas:path.posix.basename(atlasPath),textures:textures.map(t=>path.posix.relative(folder,t))},null,2));
        progress({completed:i+1,total:project.members.length,name:displayName,phase:'copying'});
      }
      await add('project.json',JSON.stringify(manifest,null,2));
      const csvCell=value=> {const text=String(value??'');return `"${(/^[=+\-@\t\r]/.test(text)?"'":"")+text.replace(/"/g,'""')}"`;};
      await add('资源清单.csv','\uFEFF'+[['分类','名称','所选皮肤','运行时皮肤','Spine 版本','动画数量','骨骼文件','图集文件'],...manifest.assets.map(a=>[a.category,a.name,a.skin,a.runtimeSkin,a.spineVersion,a.animations.length,a.skeleton,a.atlas])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
      await add('使用说明.txt',`${project.name} — Spine 通用素材包\n\n按分类保存，每份素材含同目录的 skeleton.json 或 skeleton.skel、skeleton.atlas、page-*.png（或其他贴图格式）和 asset.json。project.json 与资源清单.csv 记录全部资源。骨骼与图集使用相同文件名前缀，便于 Cocos 自动关联。\n\n导入游戏引擎时使用匹配 spineVersion 的 Spine 运行库；不同主次版本不可混用。保留图集和贴图的相对路径，并按 pma 设置透明度。本包选择的目标版本：${plan.targetVersion}。未转换版本且未合并新增皮肤时，骨骼字节不变；转换的素材使用 Spine 编辑器重新导出并通过目标运行库检查，sourceSpineVersion 记录转换前版本，spineVersion 记录实际导出版本。Cocos Creator 3.8.8 的内置运行库可选 3.8 或 4.2；4.1 素材需用匹配的 Spine 编辑器重新导出，3.8.75 也被该引擎明确拒绝，需重新导出为兼容版本（如 3.8.99）。\n\n皮肤导出方式：${plan.skinMode}。switchable 包含原生皮肤和全部新增外观，asset.json 的 skins 列出可切换的皮肤名。在 Cocos Creator 中可从皮肤下拉框切换，或调用 skeleton.setSkin(皮肤名)，再调用 skeleton.setSlotsToSetupPose() 恢复插槽设置姿势。runtimeSkin 记录项目选中的初始皮肤。current 将项目所选外观固化到贴图中，使用 runtimeSkin，外观名称 skin 可能与它不同。\n\n此包是可导入的素材集合，不包含场景、脚本或特定引擎工程。资源库中的原文件保持原样。\n`);
      await add('SHA256SUMS.txt',entries.map(e=>`${e.sha256}  ${e.path}`).join('\n')+'\n');
      progress({completed:project.members.length,total:project.members.length,name:'',phase:'packing'});
      const zip=new ZipFile();
      zip.on('error',error=>zip.outputStream.destroy(error));
      const output=pipeline(zip.outputStream,createWriteStream(temporary,{flags:'wx'}));
      try {
        for(const entry of entries)zip.addFile(entry.file,`${rootName}/${entry.path}`);
        zip.end();await output;
      } catch(error) {zip.outputStream.destroy(error);await output.catch(()=>{});throw error;}
      await fs.rename(temporary,destination);
      return {path:destination,assets:manifest.assets.length,bytes:(await fs.stat(destination)).size,bakedSkins:manifest.assets.filter(a=>a.bakedSkin).length,converted:manifest.assets.filter(a=>a.converted).length};
    } finally {await fs.rm(work,{recursive:true,force:true});await fs.rm(temporary,{force:true});}
  }
}
module.exports={ProjectService,DEFAULT_CATEGORIES,filename};
