const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ReskinService}=require('./reskin.cjs');
const {buildSpine}=require('./spine-builder.cjs');
const {writeGenerationPreview}=require('./generation-preview.cjs');
const guide=require('./generation-guide.cjs');
const presets=require('./animation-presets.json');
const check=(value,message)=>{if(!value)throw new Error(message);};
class GenerationService extends ReskinService {
  constructor(library,changed) {
    super(library,changed);this.generation=true;
    this.root=path.join(library.root,'GenerationJobs');this.index=path.join(this.root,'jobs.json');
  }
  async init() {
    await fs.mkdir(this.root,{recursive:true});
    try {this.jobs=JSON.parse(await fs.readFile(this.index,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    check(Array.isArray(this.jobs),'制作任务记录损坏。');
    for(const job of this.jobs) {
      const asset=this.library.data.assets.find(a=>a.generationTaskId===job.id);
      if(asset){job.status='completed';job.assetId=asset.id;job.message='Spine 已加入资源库';}
      else if(job.status==='applying'){job.status='failed';job.message='上次导入中断，可以重试。';}
    }
    await this.save();
  }
  async create({name,prompt,animations,animationRequirements}) {
    check(typeof name==='string'&&name.trim().length>0&&name.trim().length<=60,'请填写 1–60 字的角色名称。');
    check(typeof prompt==='string'&&prompt.trim().length>0&&prompt.length<=4000,'请填写制作需求（最多 4000 字）。');
    if(animationRequirements!==undefined) {
      check(Array.isArray(animationRequirements)&&animationRequirements.length>0&&animationRequirements.length<=32,'请添加 1–32 个动作。');
      check(animationRequirements.every(a=>a&&typeof a.name==='string'&&typeof a.description==='string'&&a.description.trim().length>0&&a.description.length<=1000),'每个动作都需要填写动作内容（最多 1000 字）。');
      animationRequirements=animationRequirements.map(a=>({name:a.name.trim(),description:a.description.trim()}));
      const names=animationRequirements.map(a=>a.name);
      if(animations!==undefined)check(JSON.stringify(animations)===JSON.stringify(names),'动作名称与动作内容表不一致。');
      animations=names;
    }else if(animations===undefined) {
      animationRequirements=presets.map(({name,description})=>({name,description}));
      animations=animationRequirements.map(a=>a.name);
    }
    check(Array.isArray(animations)&&animations.length>0&&animations.length<=32&&animations.every(a=>typeof a==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(a))&&new Set(animations).size===animations.length,'请填写 1–32 个不重复的英文动作名称。');
    animationRequirements??=animations.map(name=>({name,description:`按整体制作需求设计 ${name} 动作。`}));
    check(!this.jobs.some(j=>['queued','processing','applying'].includes(j.status)),'已有 Spine 制作任务进行中，请先完成或取消。');
    const job={id:randomUUID(),kind:'generation',name:name.trim(),prompt:prompt.trim(),animations,animationRequirements,assetId:'',assetName:name.trim(),baseSkin:'default',status:'queued',message:'等待制作',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await fs.mkdir(path.join(this.dir(job),'result'),{recursive:true});
    this.jobs.push(job);await this.save();await this.progress.record(job,{kind:'status',status:'info',text:'制作任务已创建'});this.changed(false);
    return {job,handoff:this.handoff(job.id)};
  }
  handoff(id) {
    const j=this.task(id);
    const actions=(j.animationRequirements||j.animations.map(name=>({name,description:'按整体制作需求设计。'}))).map(a=>`${a.name}：${a.description}`).join('\n');
    return `通过 spine-shelf MCP 从零制作一个可播放的 Spine 4.2 角色。任务 ${j.id}。先调用 spine_generate_get_task，按返回的 workflow 设计关节、承重与关键姿势。角色名称：${j.name}；需求：${j.prompt}。\n必须按以下动作名称及对应内容逐项制作，不要遗漏、改名或用相同动作替代：\n${actions}\n使用内置 image_gen.imagegen 生成透明部件素材，不能用代码绘制占位图冒充成品。骨骼和动作由你依据需求设计，支持加权网格、IK 和 Bezier 缓动，按解剖需要使用，不能以整条腿单骨骼摆动代替屈伸。所有制作文件在任务目录；把部件 PNG 与 rig.json 放到 result，调用 spine_generate_preview 获取预览并检查关键姿势，修正后再 spine_generate_apply。无法视觉检查时如实报告，不能把运行库校验通过当作动作自然的证据。MCP 会打包 atlas、生成 Spine JSON、用官方运行库检查后导入。不要直接修改 Library。定期调用 spine_generate_update_task 报告进度。生成失败则报告 failed。不要依赖未安装的个人技能。`;
  }
  async context(id) {
    const job=this.task(id);
    return {job,resultDir:path.join(this.dir(job),'result'),version:'4.2',
      ...guide,
      manifest:{bones:[{name:'root'},{name:'body',parent:'root',x:0,y:150}],parts:[{name:'body',bone:'body',file:'body.png',x:0,y:0,width:180,height:240},{name:'head',bone:'body',file:'head.png',x:0,y:150,width:120,height:120}],animations:{idle:{bones:{body:{rotate:[{time:0,value:-2},{time:1,value:2},{time:2,value:-2}]}}}}},
      };
  }
  async preview(id) {
    const job=this.task(id),output=path.join(this.root,'.compiled',job.id);
    const validation=await buildSpine(path.join(this.dir(job),'result'),output,job.animations);
    const previewPath=await writeGenerationPreview(output,validation);
    return {previewPath,validation,message:'用浏览器打开 preview.html 检查各动作和骨骼网格；此步骤尚未导入资源库。'};
  }
  async apply(id) {
    const job=this.task(id);
    if(job.status==='completed')return {job,asset:this.library.asset(job.assetId)};
    check(['queued','processing'].includes(job.status),'请先开始或重试任务。');
    const committed=this.library.data.assets.find(a=>a.generationTaskId===id);
    if(committed) {
      job.assetId=committed.id;job.status='completed';job.message='Spine 已加入资源库';job.updatedAt=new Date().toISOString();
      await this.save();this.changed(true);return {job,asset:committed};
    }
    const output=path.join(this.root,'.compiled',job.id);
    const validation=await buildSpine(path.join(this.dir(job),'result'),output,job.animations);
    job.status='applying';job.updatedAt=new Date().toISOString();await this.save();this.changed(false);
    try {
      const report=await this.library.importPaths([path.join(output,'skeleton.json')],{generationTaskId:id,name:job.name});
      check(report.added.length===1,report.errors[0]?.message || '生成结果已存在，请调整后重试。');
      job.assetId=report.added[0];job.status='completed';job.message='Spine 已加入资源库';job.updatedAt=new Date().toISOString();
      await this.save();await this.progress.record(job,{kind:'status',status:'completed',text:job.message});this.changed(true);
      return {job,asset:this.library.asset(job.assetId),validation};
    }catch(e){job.status='failed';job.message=e.message;await this.save();this.changed(false);throw e;}
  }
}
module.exports={GenerationService};
