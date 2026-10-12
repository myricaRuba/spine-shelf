const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const runtimes = new Map();

async function runtime(version) {
  if (!runtimes.has(version)) runtimes.set(version, (async()=>{
    const candidates = version === '3.8' || version === '3.6'
      ? [path.join(__dirname,`../dist/vendor/spine${version.replace('.','')}.js`),path.join(__dirname,`../public/vendor/spine${version.replace('.','')}.js`)]
      : [path.join(path.dirname(require.resolve(`spine${version.replace('.','')}`)),'iife','spine-webgl.js')];
    let source;
    for (const file of candidates) {try {source=await fs.readFile(file,'utf8');break;} catch(error) {if(error.code!=='ENOENT')throw error;}}
    if (!source) throw new Error(`缺少 Spine ${version} 校验运行库。`);
    const context = vm.createContext({console, setTimeout, clearTimeout});
    vm.runInContext(source,context);
    return version === '3.6' ? context.spine36 : context.spine;
  })());
  return runtimes.get(version);
}

async function loadSkeletonData(result,atlasText) {
  const rt = await runtime(result.runtime);
  const texture = {getImage:()=>({width:2048,height:2048}),setFilters(){},setWraps(){},dispose(){}};
  const atlas = new rt.TextureAtlas(atlasText,()=>texture);
  for (const page of atlas.pages) if (page.setTexture) page.setTexture(texture);
  let data;
  try {
    data = new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(result.json);
  } catch (error) {
    const missing = /^Region not found in atlas: (.*?) \((?:region|mesh) attachment:/.exec(error.message);
    if (missing) throw new Error(`图集缺少图块「${missing[1]}」。骨骼与图集不匹配或素材不完整，请补齐对应的 atlas 和贴图。`);
    throw error;
  }
  return {rt,data};
}
async function validateConvertedSkeleton(result, atlasText, asset, runtimeSkin, {allSkins=false}={}) {
  const {rt,data}=await loadSkeletonData(result,atlasText);
  const animations = data.animations.map(a=>a.name), skins = data.skins.map(s=>s.name);
  for (const name of asset.animations) if (!animations.includes(name)) throw new Error(`转换丢失动画「${name}」，已停止导出。`);
  const nativeSkins=(asset.skins || []).filter(name=>allSkins || !asset.reskins?.some(layer=>layer.name===name));
  for(const skin of new Set([runtimeSkin,...nativeSkins])) if (!skins.includes(skin)) throw new Error(`转换后找不到皮肤「${skin}」，已停止导出。`);
  if (data.bones.length !== asset.bones || data.slots.length !== asset.slots) throw new Error('转换前后的骨骼或插槽数量不一致，已停止导出。');
  const skeleton = new rt.Skeleton(data);
  const modernPose=result.runtime==='4.3';
  const state=new rt.AnimationState(new rt.AnimationStateData(data));
  for(const name of allSkins?skins:[runtimeSkin]) {
    if(modernPose)skeleton.setSkin(name);else skeleton.setSkinByName(name);
  for (const animation of data.animations.length?data.animations:[{name:'设置姿势',duration:0}]) {
    if (!Number.isFinite(animation.duration)) throw new Error(`动画「${animation.name}」时长无效。`);
    for (const ratio of [0,.25,.5,.75,1]) {
      if(modernPose)skeleton.setupPose();else skeleton.setToSetupPose();
      state.clearTracks();if(data.animations.length)state.setAnimation(0,animation.name,false);state.update(animation.duration*ratio);state.apply(skeleton);
      skeleton.updateWorldTransform(rt.Physics?.reset);
      for (const item of skeleton.bones) {
        const bone=modernPose?item.appliedPose:item;
        if (![bone.worldX,bone.worldY,bone.a,bone.b,bone.c,bone.d].every(Number.isFinite)) throw new Error(`动画「${animation.name}」的骨骼变换无效。`);
      }
      for (const slot of skeleton.slots) {
        const a=modernPose?slot.appliedPose.attachment:slot.attachment;
        if (a instanceof rt.MeshAttachment) {
          const vertices=new Float32Array(a.worldVerticesLength);
          if(modernPose)a.computeWorldVertices(skeleton,slot,0,vertices.length,vertices,0,2);
          else a.computeWorldVertices(slot,0,vertices.length,vertices,0,2);
          if (!vertices.every(Number.isFinite)) throw new Error(`动画「${animation.name}」的网格顶点无效。`);
        }
      }
    }
  }
  }
  return {animations, skins, bones:data.bones.length, slots:data.slots.length};
}

module.exports={validateConvertedSkeleton,loadSkeletonData};
