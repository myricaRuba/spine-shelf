// Compile an authored rig into Spine 4.2 data. Bind coordinates are calculated
// before constraints: adding IK must not silently change the mesh's bind pose.
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { PNG } = require('pngjs');
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/);
const number = z.number().finite().min(-10000).max(10000);
const unit = z.number().finite().min(0).max(1);
const ease = z.union([z.literal('stepped'),z.tuple([unit,number,unit,number])]);
const frame = z.object({time:z.number().min(0).max(30),x:number.optional(),y:number.optional(),value:number.optional(),ease:ease.optional()}).strict();
const ikFrame = z.object({time:z.number().min(0).max(30),mix:unit.default(1),softness:z.number().min(0).max(1000).default(0),bendPositive:z.boolean().optional(),ease:ease.optional()}).strict();
const mesh = z.object({
  vertices:z.array(z.object({x:number,y:number,u:unit,v:unit,weights:z.array(z.object({bone:name,weight:z.number().positive().max(1)}).strict()).min(1).max(4)}).strict()).min(3).max(2048),
  triangles:z.array(z.number().int().min(0)).min(3).max(12288),
}).strict();
const manifestSchema = z.object({
  bones:z.array(z.object({name,parent:name.optional(),x:number.default(0),y:number.default(0),rotation:number.default(0),length:z.number().min(0).max(4096).optional()}).strict()).min(2).max(120),
  ik:z.array(z.object({name,bones:z.array(name).min(1).max(2),target:name,mix:unit.default(1),softness:z.number().min(0).max(1000).default(0),bendPositive:z.boolean().default(true)}).strict()).max(32).default([]),
  parts:z.array(z.object({name,bone:name,file:z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),x:number.default(0),y:number.default(0),rotation:number.default(0),width:z.number().positive().max(2048).optional(),height:z.number().positive().max(2048).optional(),color:z.string().regex(/^[0-9a-fA-F]{8}$/).optional(),mesh:mesh.optional()}).strict()).min(2).max(60),
  animations:z.record(name,z.object({loop:z.boolean().default(false),bones:z.record(name,z.object({rotate:z.array(frame).min(2).max(120).optional(),translate:z.array(frame).min(2).max(120).optional(),scale:z.array(frame).min(2).max(120).optional()}).strict()).default({}),ik:z.record(name,z.array(ikFrame).min(2).max(120)).default({})}).strict()),
}).strict();
const check=(condition,message)=>{if(!condition)throw new Error(message);};
// Manifest easing uses normalized cubic Beziers; Spine 4.2 stores absolute
// time/value control points, with a separate four-number curve per channel.
function compileFrames(frames,keys,defaults=0) {
  return frames.map(({ease,...frame},i)=>{
    if(!ease||i===frames.length-1)return frame;
    if(ease==='stepped')return {...frame,curve:'stepped'};
    const next=frames[i+1],dt=next.time-frame.time;
    return {...frame,curve:keys.flatMap(key=>{
      const a=frame[key]??defaults,b=next[key]??defaults;
      return [frame.time+ease[0]*dt,a+ease[1]*(b-a),frame.time+ease[2]*dt,a+ease[3]*(b-a)];
    })};
  });
}
function validateTimes(frames,animation) {
  check(frames[0].time===0,`动画 ${animation} 必须从 0 秒开始。`);
  let previous=-1;
  for(const f of frames) {check(f.time>previous,'关键帧时间必须递增。');previous=f.time;}
}
function worldVertices(rt,skeleton) {
  const values=[];
  for(const slot of skeleton.slots) {
    const a=slot.attachment;if(!a)continue;
    if(a instanceof rt.MeshAttachment) {
      const vertices=new Float32Array(a.worldVerticesLength);a.computeWorldVertices(slot,0,vertices.length,vertices,0,2);values.push(...vertices);
    }else if(a instanceof rt.RegionAttachment) {
      const vertices=new Float32Array(8);a.computeWorldVertices(slot,vertices,0,2);values.push(...vertices);
    }
  }
  return values;
}
async function readLocal(root,file,maxBytes) {
  const base=await fs.realpath(root), target=await fs.realpath(path.join(base,file));
  check(target.startsWith(base+path.sep),'制作文件不能指向任务目录外。');
  const stat=await fs.stat(target);check(stat.isFile()&&stat.size<=maxBytes,'制作文件过大或不是普通文件。');
  return fs.readFile(target);
}
async function buildSpine(resultDir, outputDir, requiredAnimations) {
  const raw=await readLocal(resultDir,'rig.json',2*1024*1024);
  const parsed=manifestSchema.safeParse(JSON.parse(raw.toString('utf8')));
  check(parsed.success,`rig.json 格式无效：${parsed.error?.issues.slice(0,3).map(i=>`${i.path.join('.')}: ${i.message}`).join('；')}`);
  const m=parsed.data, boneNames=new Set(), partNames=new Set();
  check(!m.bones[0].parent,'第一个骨骼必须是根骨骼。');
  for(const [i,bone] of m.bones.entries()) {
    check(!boneNames.has(bone.name),'骨骼名称重复。');
    check(i===0 || boneNames.has(bone.parent),'父骨骼必须排在子骨骼前面。');boneNames.add(bone.name);
  }
  const boneByName=new Map(m.bones.map(b=>[b.name,b])),ikNames=new Set(),constrained=new Set();
  for(const constraint of m.ik) {
    check(!ikNames.has(constraint.name),'IK 名称重复。');ikNames.add(constraint.name);
    check(boneNames.has(constraint.target)&&constraint.bones.every(b=>boneNames.has(b)),'IK 引用了不存在的骨骼。');
    check(new Set(constraint.bones).size===constraint.bones.length,'IK 链不能重复骨骼。');
    for(const b of constraint.bones) {
      check(!constrained.has(b),'一个骨骼不能属于多条 IK 链。');constrained.add(b);
      check(boneByName.get(b).length>0,'IK 骨骼需要正数 length。');
    }
    if(constraint.bones.length===2) {
      const child=boneByName.get(constraint.bones[1]);
      check(boneByName.get(constraint.bones[0]).parent,'双骨骼 IK 的父骨骼不能是根骨骼。');
      check(child.parent===constraint.bones[0]&&child.y===0&&child.x>0,'双骨骼 IK 需要直接父子关系，子骨骼 x > 0、y = 0。');
    }
    // Independent targets avoid constraint cycles and ordering ambiguities.
    for(let b=boneByName.get(constraint.target);b;b=boneByName.get(b.parent))check(!m.ik.some(c=>c.bones.includes(b.name)),'IK 目标不能位于受约束骨骼下。');
  }
  const animationNames=Object.keys(m.animations);
  check(animationNames.length>0&&animationNames.length<=32,'需要 1–32 个动画。');
  for(const wanted of requiredAnimations)check(animationNames.includes(wanted),`缺少要求的动画：${wanted}`);
  for(const [animation,tracks] of Object.entries(m.animations)) {
    let moves=false;
    for(const [bone,timelines] of Object.entries(tracks.bones)) {
      check(boneNames.has(bone),`动画 ${animation} 引用了不存在的骨骼。`);
      for(const [kind,frames] of Object.entries(timelines)) {
        validateTimes(frames,animation);
        for(const f of frames) {
          check(kind==='rotate' ? f.value!==undefined&&f.x===undefined&&f.y===undefined : f.value===undefined&&(f.x!==undefined||f.y!==undefined),'旋转帧使用 value，位移和缩放使用 x/y。');
        }
        const defaults=kind==='scale'?1:0;
        moves ||= frames.some(f=>['x','y','value'].some(key=>(f[key]??defaults)!==(frames[0][key]??defaults)));
      }
    }
    for(const [constraint,frames] of Object.entries(tracks.ik)) {
      check(ikNames.has(constraint),`动画 ${animation} 引用了不存在的 IK。`);validateTimes(frames,animation);
      moves ||= frames.some(f=>['mix','softness','bendPositive'].some(key=>f[key]!==frames[0][key]));
    }
    check(moves,`动画 ${animation} 没有变化的关键帧。`);
  }
  const images=[];let x=2,y=2,rowHeight=0,totalPixels=0;
  for(const part of m.parts) {
    check(!partNames.has(part.name)&&boneNames.has(part.bone),'部件名称重复或绑定骨骼不存在。');partNames.add(part.name);
    const bytes=await readLocal(resultDir,part.file,16*1024*1024);
    check(bytes.length>24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'部件必须是 PNG。');
    const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
    totalPixels+=w*h;
    check(w>0&&h>0&&w<=2048&&h<=2048&&totalPixels<=16000000,'部件尺寸或总像素过大。');
    const image=PNG.sync.read(bytes);let visible=false,transparent=false;
    for(let i=3;i<image.data.length;i+=4){visible ||= image.data[i]>0;transparent ||= image.data[i]<255;}
    check(visible&&transparent,`部件 ${part.name} 必须包含可见内容和透明背景。`);
    if(x+w+2>4096){x=2;y+=rowHeight+4;rowHeight=0;}
    check(y+h+2<=4096,'部件无法放入 4096×4096 图集，请缩小部件。');
    images.push({part,image,x,y});x+=w+4;rowHeight=Math.max(rowHeight,h);
  }
  const width=Math.max(...images.map(i=>i.x+i.image.width))+2,height=y+rowHeight+2;
  const sheet=new PNG({width,height});sheet.data.fill(0);
  let atlas=`texture.png\nsize: ${width},${height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npma: false\n`;
  const rt=await import('spine42');
  const bindData=new rt.SkeletonJson({}).readSkeletonData({bones:m.bones});
  const bind=new rt.Skeleton(bindData);bind.updateWorldTransform(rt.Physics.none);
  const slots=[],attachments={};let vertexCount=0;
  for(const {part,image,x,y} of images) {
    PNG.bitblt(image,sheet,0,0,image.width,image.height,x,y);
    atlas+=`${part.name}\n  rotate: false\n  xy: ${x},${y}\n  size: ${image.width},${image.height}\n  orig: ${image.width},${image.height}\n  offset: 0,0\n  index: -1\n`;
    slots.push({name:part.name,bone:part.bone,attachment:part.name,...(part.color?{color:part.color}:{})});
    let attachment={type:'region',path:part.name,x:part.x,y:part.y,rotation:part.rotation,width:part.width??image.width,height:part.height??image.height};
    if(part.mesh) {
      const {vertices,triangles}=part.mesh;vertexCount+=vertices.length;
      check(vertexCount<=16000,'网格总顶点数过多。');
      check(triangles.length%3===0&&triangles.every(i=>i<vertices.length),`部件 ${part.name} 的三角形索引无效。`);
      const used=new Set(triangles);check(used.size===vertices.length,`部件 ${part.name} 有未使用的网格顶点。`);
      for(let i=0;i<triangles.length;i+=3) {
        const [a,b,c]=triangles.slice(i,i+3).map(j=>vertices[j]);
        check(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))>1e-6&&Math.abs((b.u-a.u)*(c.v-a.v)-(b.v-a.v)*(c.u-a.u))>1e-8,`部件 ${part.name} 有退化的网格三角形。`);
      }
      const packed=[],slotBone=bind.findBone(part.bone),rad=part.rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
      for(const v of vertices) {
        check(new Set(v.weights.map(w=>w.bone)).size===v.weights.length&&v.weights.every(w=>boneNames.has(w.bone)),`部件 ${part.name} 权重骨骼无效或重复。`);
        check(Math.abs(v.weights.reduce((sum,w)=>sum+w.weight,0)-1)<0.0001,`部件 ${part.name} 顶点权重之和必须为 1。`);
        const world=slotBone.localToWorld(new rt.Vector2(part.x+v.x*cos-v.y*sin,part.y+v.x*sin+v.y*cos));
        packed.push(v.weights.length);
        for(const w of v.weights) {
          const bone=bind.findBone(w.bone),local=bone.worldToLocal(new rt.Vector2(world.x,world.y));
          packed.push(bone.data.index,local.x,local.y,w.weight);
        }
      }
      attachment={type:'mesh',path:part.name,width:attachment.width,height:attachment.height,uvs:vertices.flatMap(v=>[v.u,v.v]),triangles,vertices:packed};
    }
    attachments[part.name]={[part.name]:attachment};
  }
  const animations=Object.fromEntries(Object.entries(m.animations).map(([name,a])=>[name,{
    bones:Object.fromEntries(Object.entries(a.bones).map(([bone,timelines])=>[bone,Object.fromEntries(Object.entries(timelines).map(([kind,frames])=>[kind,compileFrames(frames,kind==='rotate'?['value']:['x','y'],kind==='scale'?1:0)]))])),
    ik:Object.fromEntries(Object.entries(a.ik).map(([name,frames])=>[name,compileFrames(frames,['mix','softness'])])),
  }]));
  const json={skeleton:{spine:'4.2.0',images:'./',fps:30},bones:m.bones,ik:m.ik.map((c,order)=>({...c,order})),slots,skins:[{name:'default',attachments}],animations};
  const runtimeAtlas=new rt.TextureAtlas(atlas);
  for(const page of runtimeAtlas.pages)page.setTexture(new rt.FakeTexture({width,height}));
  const data=new rt.SkeletonJson(new rt.AtlasAttachmentLoader(runtimeAtlas)).readSkeletonData(json);
  const skeleton=new rt.Skeleton(data),samples=[];
  for(const animation of data.animations) {
    check(Number.isFinite(animation.duration)&&animation.duration>0,'动画时长无效。');
    const times=new Set([0,animation.duration]);
    const authored=m.animations[animation.name];
    for(const frames of [...Object.values(authored.bones).flatMap(t=>Object.values(t)),...Object.values(authored.ik)])for(const f of frames)times.add(Math.min(animation.duration,f.time));
    check(times.size<=4096,'单个动画的不同关键帧时间过多，请合并时间点。');
    const steps=Math.min(240,Math.ceil(animation.duration*30));
    for(let i=0;i<=steps;i++)times.add(animation.duration*i/steps);
    let first,last;
    for(const time of [...times].sort((a,b)=>a-b)) {
      skeleton.setToSetupPose();animation.apply(skeleton,-1,time,false,[],1,rt.MixBlend.replace,rt.MixDirection.mixIn);skeleton.updateWorldTransform(rt.Physics.none);
      check(skeleton.bones.every(b=>[b.worldX,b.worldY,b.a,b.b,b.c,b.d].every(Number.isFinite)),'动画含有无效变换。');
      const vertices=worldVertices(rt,skeleton);check(vertices.every(Number.isFinite),'动画含有无效网格顶点。');
      first??=vertices;last=vertices;
    }
    const seamError=Math.max(0,...first.map((v,i)=>Math.abs(v-last[i])));
    if(authored.loop)check(seamError<0.1,`循环动画 ${animation.name} 首尾网格未衔接（误差 ${seamError.toFixed(2)} 像素）。`);
    samples.push({name:animation.name,duration:animation.duration,samples:times.size,loop:authored.loop,seamError});
  }
  await fs.mkdir(outputDir,{recursive:true});
  await fs.writeFile(path.join(outputDir,'skeleton.json'),JSON.stringify(json));
  await fs.writeFile(path.join(outputDir,'texture.atlas'),atlas);
  await fs.writeFile(path.join(outputDir,'texture.png'),PNG.sync.write(sheet));
  const meshes=m.parts.filter(p=>p.mesh).length,curvedSegments=Object.values(animations).reduce((sum,a)=>sum+[...Object.values(a.bones).flatMap(b=>Object.values(b)),...Object.values(a.ik)].flat().filter(f=>Array.isArray(f.curve)).length,0);
  return {bones:m.bones.length,parts:m.parts.length,meshes,ik:m.ik.length,curvedSegments,animations:animationNames,width,height,samples,validationScope:'结构、有限坐标与声明循环的首尾衔接；不代表美术或动作质量合格。'};
}
module.exports={buildSpine};
