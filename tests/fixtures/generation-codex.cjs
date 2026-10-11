// Integration fixture: generates visibly distinct parts and actual bone keyframes.
const fs=require('node:fs/promises');
const path=require('node:path');
const {PNG}=require('pngjs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const args=process.argv.slice(2),emit=event=>console.log(JSON.stringify(event));
(async()=>{
  const setting=key=>JSON.parse(args.find(a=>a.startsWith(key+'=')).slice(key.length+1));
  const mcpArgs=setting('mcp_servers.spine-shelf.args'),taskId=mcpArgs[mcpArgs.indexOf('--task-id')+1];
  const client=new Client({name:'generation-fixture',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:setting('mcp_servers.spine-shelf.command'),args:mcpArgs,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}));
  const call=async(tool,params={})=>{const result=await client.callTool({name:'spine_generate_'+tool,arguments:{taskId,...params}});if(result.isError)throw new Error(result.content[0].text);return result.structuredContent;};
  try {
    emit({type:'thread.started',thread_id:'generation-fixture'});emit({type:'turn.started'});
    const context=await call('get_task');
    if(process.env.SPINE_FAKE_GENERATION_MODE==='wait'){await new Promise(()=>{});return;}
    await call('update_task',{status:'processing',message:'正在制作透明部件和骨骼动画（集成测试）'});
    const m=context.manifest;
    for(const [i,part] of m.parts.entries()) {
      const png=new PNG({width:64,height:64});png.data.fill(0);
      for(let y=8;y<56;y++)for(let x=8;x<56;x++) {const p=(y*64+x)*4;png.data[p]=i?240:90;png.data[p+1]=i?175:170;png.data[p+2]=i?90:110;png.data[p+3]=255;}
      await fs.writeFile(path.join(context.resultDir,part.file),PNG.sync.write(png));
    }
    m.animations=Object.fromEntries(context.job.animations.map(name=>[name,{bones:{body:{rotate:[{time:0,value:-15},{time:0.5,value:15},{time:1,value:-15}]}}}]));
    await fs.writeFile(path.join(context.resultDir,'rig.json'),JSON.stringify(m));
    await call('apply');emit({type:'turn.completed'});
  } finally {await client.close();}
})().catch(e=>{emit({type:'turn.failed',error:{message:e.message}});process.exitCode=1;});
