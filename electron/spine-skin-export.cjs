const fs=require('node:fs/promises');
const path=require('node:path');
const {atlasPages}=require('./library.cjs');
const {safeFile}=require('./reskin.cjs');
const check=(ok,message)=>{if(!ok)throw new Error(message);};

function skinMode(options={}) {
  const mode=options.skinMode ?? 'switchable';
  check(['switchable','current'].includes(mode),'请选择有效的皮肤导出方式。');
  return mode;
}
function nativeSkin(asset,name) {
  const visited=new Set();
  while(true) {
    check(!visited.has(name),'皮肤引用循环，请修复素材。');visited.add(name);
    const layer=asset.reskins?.find(s=>s.name===name);
    if(!layer)return name;
    name=layer.baseSkin;
  }
}

// Build independent native attachments and duplicate their attachment timelines.
// Slot attachment keys stay unchanged, so all existing attachment/draw-order tracks work.
function mergeSkinJSON(source,layers,prefixes) {
  const json=structuredClone(source);
  const legacySkins = !Array.isArray(json.skins);
  if(!Array.isArray(json.skins))json.skins=Object.entries(json.skins || {}).map(([name,attachments])=>({name,attachments}));
  const native=new Map(json.skins.map(s=>[s.name,s]));
  const lookup=(skin,slot,key)=> {
    const value=native.get(skin)?.attachments?.[slot]?.[key];
    check(value,`皮肤「${skin}」缺少附件 ${slot}/${key}。`);return value;
  };
  const link=(skin,slot,key)=>{
    const a=lookup(skin,slot,key),parent=a.parent ?? a.source;
    return parent ? {skin:a.skin || 'default',slot:a.slot || slot,key:parent} : null;
  };
  const geometry=(skin,slot,key,seen=new Set())=>{
    const id=JSON.stringify([skin,slot,key]);check(!seen.has(id),'网格引用循环，无法合并皮肤。');seen.add(id);
    const next=link(skin,slot,key);return next?geometry(next.skin,next.slot,next.key,seen):lookup(skin,slot,key);
  };
  for(const [index,layer] of layers.entries()) {
    check(!native.has(layer.name) && !json.skins.some(s=>s.name===layer.name),`皮肤名称重复：${layer.name}`);
    const baseName=nativeSkin({reskins:layers},layer.baseSkin),base=native.get(baseName);
    check(base,`基础皮肤不存在：${baseName}`);
    const skin={...structuredClone(base),name:layer.name,attachments:Object.create(null)};
    const effective=new Map();
    for(const origin of [native.get('default'),base].filter(Boolean)) {
      for(const [slot,entries] of Object.entries(origin.attachments || {}))for(const key of Object.keys(entries))effective.set(JSON.stringify([slot,key]),{skin:origin.name,slot,key});
      // Preserve skin-required bones/constraints from both the base and fallback skin.
      for(const [key,value] of Object.entries(origin))if(Array.isArray(value))skin[key]=[...new Set([...(skin[key] || []),...value])];
    }
    for(const origin of effective.values()) {
      const {slot,key}=origin,original=lookup(origin.skin,slot,key),a=structuredClone(original),type=a.type || 'region';
      let timelineOrigin=origin;
      if(type==='mesh' || type==='linkedmesh') {
        const parent=link(origin.skin,slot,key);
        if(parent) {
          const mesh=geometry(origin.skin,slot,key);
          for(const field of ['uvs','vertices','triangles','hull','edges'])if(mesh[field]!==undefined)a[field]=structuredClone(mesh[field]);
          if((a.timelines ?? a.deform ?? true)!==false)timelineOrigin=parent;
          for(const field of ['parent','source','skin','slot','deform','timelines'])delete a[field];
        }
        a.type='mesh';
      }
      if(['region','mesh','linkedmesh'].includes(type))a.path=prefixes[index]+(original.path ?? original.name ?? key);
      skin.attachments[slot] ??= Object.create(null);skin.attachments[slot][key]=a;
      for(const animation of Object.values(json.animations || {})) {
        for(const section of ['deform','attachments']) {
          const timeline=animation[section]?.[timelineOrigin.skin]?.[timelineOrigin.slot]?.[timelineOrigin.key];
          if(timeline===undefined)continue;
          if(!Object.hasOwn(animation[section],layer.name))Object.defineProperty(animation[section],layer.name,{value:Object.create(null),enumerable:true,writable:true,configurable:true});
          animation[section][layer.name][slot] ??= Object.create(null);
          animation[section][layer.name][slot][key]=structuredClone(timeline);
        }
      }
    }
    json.skins.push(skin);
  }
  if(json.skeleton)delete json.skeleton.hash;
  if (legacySkins) json.skins = Object.fromEntries(json.skins.map(skin => [skin.name, skin.attachments]));
  return json;
}

async function prepareSkinExport({base,asset,output,selectedSkin,mode}) {
  const layers=asset.reskins || [],merge=mode==='switchable' && layers.length>0;
  const selectedLayer=layers.find(s=>s.name===selectedSkin);
  check(!merge || output.format==='json','可切换皮肤需要 JSON 骨骼，请连接 Spine 将 SKEL 转为 JSON 后导出。');
  const sources=merge?['texture.atlas',...layers.map(l=>l.atlas)]:[mode==='current' && selectedLayer?selectedLayer.atlas:'texture.atlas'];
  const atlases=await Promise.all(sources.map(async relative=>({relative,...atlasPages(await fs.readFile(await safeFile(base,relative),'utf8'))})));
  const regionNames=new Set(atlases[0].lines.map(line=>line.trim()).filter(line=>line && !line.includes(':')));
  const prefixes=layers.map((_,i)=>{
    let prefix=`__shelf_skin_${i+1}/`;while([...regionNames].some(n=>n.startsWith(prefix)))prefix='_'+prefix;return prefix;
  });
  const textures=[],texts=[];
  for(const [index,atlas] of atlases.entries()) {
    check(atlas.pages.length>0,`${asset.name} 的图集没有贴图页。`);
    const pageLines=new Set(atlas.pages.map(p=>p.line));
    if(merge && index>0)for(let n=0;n<atlas.lines.length;n++) {
      const text=atlas.lines[n].trim();
      if(text && !text.includes(':') && !pageLines.has(n))atlas.lines[n]=prefixes[index-1]+text;
    }
    for(const [n,page] of atlas.pages.entries()) {
      const file=await safeFile(base,path.posix.join(path.posix.dirname(atlas.relative),page.name)),extension=path.extname(file).toLowerCase();
      check(['.png','.jpg','.jpeg','.webp'].includes(extension),`${asset.name} 包含不支持的贴图格式。`);
      const name=index===0?`page-${n}${extension}`:`skin-${index}-page-${n}${extension}`;
      textures.push({name,bytes:await fs.readFile(file)});atlas.lines[page.line]=name;
    }
    texts.push(atlas.lines.join('\n').trim());
  }
  let json=output.json || (output.format==='json'?JSON.parse(output.bytes.toString('utf8')):null);
  if(merge)json=mergeSkinJSON(json,layers,prefixes);
  const skins=json?(Array.isArray(json.skins)?json.skins.map(s=>s.name):Object.keys(json.skins || {})):asset.skins.filter(s=>!layers.some(l=>l.name===s));
  return {output:merge?{...output,json,bytes:Buffer.from(JSON.stringify(json)),format:'json'}:output,atlas:texts.join('\n\n')+'\n',textures,
    merged:merge,skins,skinMode:mode,runtimeSkin:mode==='current'?nativeSkin(asset,selectedSkin):selectedSkin,bakedSkin:mode==='current' && !!selectedLayer};
}

module.exports={skinMode,nativeSkin,mergeSkinJSON,prepareSkinExport};
