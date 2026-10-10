const fs = require('node:fs/promises');
const {createWriteStream} = require('node:fs');
const {pipeline} = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID,createHash} = require('node:crypto');
const {ZipFile} = require('yazl');
const {atlasPages} = require('./library.cjs');
const {safeFile} = require('./reskin.cjs');

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
  constructor(library) {this.library=library;}
  project(id) {const p=this.library.data.projects.find(p=>p.id===id);check(p,'项目不存在。');return p;}
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
  async export(id,destination,progress=()=>{}) {
    const project=structuredClone(this.project(id));
    check(project.members.length>0,'项目里还没有素材，请先从资源库添加。');
    check(typeof destination==='string' && path.isAbsolute(destination) && /\.zip$/i.test(destination),'请选择 ZIP 保存位置。');
    const parent=await fs.realpath(path.dirname(destination));
    const libraryRoot=await fs.realpath(this.library.root);
    check(parent!==libraryRoot && !parent.startsWith(libraryRoot+path.sep),'请将导出包保存在资源库目录之外。');
    const work=await fs.mkdtemp(path.join(os.tmpdir(),'spine-project-'));
    const temporary=path.join(parent,`.spine-export-${randomUUID()}.tmp`);
    const entries=[],manifest={schemaVersion:1,name:project.name,note:project.note,exportedAt:new Date().toISOString(),categories:[],assets:[]};
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
        let runtimeSkin=member.skin,layer=asset.reskins?.find(s=>s.name===runtimeSkin),selectedLayer=layer;
        const seen=new Set();
        while(layer) {check(!seen.has(runtimeSkin),'皮肤引用循环，请修复素材。');seen.add(runtimeSkin);runtimeSkin=layer.baseSkin;layer=asset.reskins?.find(s=>s.name===runtimeSkin);}
        check(asset.skins.includes(runtimeSkin),`${asset.name} 的基础皮肤「${runtimeSkin}」已不存在，请修复素材。`);
        const atlasRelative=selectedLayer?.atlas || 'texture.atlas';
        const atlas=await fs.readFile(await safeFile(base,atlasRelative),'utf8');
        const {lines,pages}=atlasPages(atlas);check(pages.length>0,`${asset.name} 的图集没有贴图页。`);
        const textures=[];
        for(const [n,page] of pages.entries()) {
          const source=await safeFile(base,path.posix.join(path.posix.dirname(atlasRelative),page.name));
          const extension=path.extname(source).toLowerCase();
          check(['.png','.jpg','.jpeg','.webp'].includes(extension),`${asset.name} 包含不支持的贴图格式。`);
          const target=`textures/page-${n}${extension}`;
          await add(`${folder}/${target}`,await fs.readFile(source));lines[page.line]=target;textures.push(`${folder}/${target}`);
        }
        const skeleton=`${folder}/skeleton.${asset.format}`,atlasPath=`${folder}/texture.atlas`;
        await add(skeleton,await fs.readFile(await safeFile(base,`skeleton.${asset.format}`)));
        await add(atlasPath,lines.join('\n'));
        const item={id:asset.id,name:displayName,categoryId:category.id,category:category.name,skin:member.skin,runtimeSkin,bakedSkin:!!selectedLayer,
          spineVersion:asset.version,runtimeVersion:asset.runtime,format:asset.format,pma:asset.pma,animations:asset.animations,note:member.note,
          skeleton,atlas:atlasPath,textures};
        manifest.assets.push(item);
        await add(`${folder}/asset.json`,JSON.stringify({...item,skeleton:path.posix.basename(skeleton),atlas:'texture.atlas',textures:textures.map(t=>path.posix.relative(folder,t))},null,2));
        progress({completed:i+1,total:project.members.length,name:displayName,phase:'copying'});
      }
      await add('project.json',JSON.stringify(manifest,null,2));
      const csvCell=value=> {const text=String(value??'');return `"${(/^[=+\-@\t\r]/.test(text)?"'":"")+text.replace(/"/g,'""')}"`;};
      await add('资源清单.csv','\uFEFF'+[['分类','名称','所选皮肤','运行时皮肤','Spine 版本','动画数量','骨骼文件','图集文件'],...manifest.assets.map(a=>[a.category,a.name,a.skin,a.runtimeSkin,a.spineVersion,a.animations.length,a.skeleton,a.atlas])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
      await add('使用说明.txt',`${project.name} — Spine 通用素材包\n\n按分类保存，每份素材含骨骼文件、texture.atlas、textures 和 asset.json。project.json 与资源清单.csv 记录全部资源。\n\n导入游戏引擎时使用匹配 spineVersion 的 Spine 运行库；不同主次版本不可混用。保留图集和贴图的相对路径，并按 pma 设置透明度。\n\n每个素材导出项目所选的一套外观。AI 新皮肤已固化到这份导出贴图中，骨骼和动画不变；游戏里选择 asset.json 中的 runtimeSkin。skin 是项目中的外观名称，可能与骨骼中的 runtimeSkin 不同。这种导出不包含在一个骨骼内切换所有 AI 皮肤的数据。\n\n此包是可导入的素材集合，不包含场景、脚本或特定引擎工程。资源库中的原文件保持原样。\n`);
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
      return {path:destination,assets:manifest.assets.length,bytes:(await fs.stat(destination)).size,bakedSkins:manifest.assets.filter(a=>a.bakedSkin).length};
    } finally {await fs.rm(work,{recursive:true,force:true});await fs.rm(temporary,{force:true});}
  }
}
module.exports={ProjectService,DEFAULT_CATEGORIES,filename};
