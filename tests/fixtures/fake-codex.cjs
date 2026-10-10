#!/usr/bin/env node
// Deterministic process fixture, never used by the installed application.
const args=process.argv.slice(2);
if(args.includes('--help')) {console.log('--ignore-user-config');process.exit(0);}
if(args.includes('login')) {console.log('Logged in using ChatGPT');process.exit(0);}
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
emit({type:'thread.started',thread_id:'fixture-codex-thread'});
emit({type:'turn.started'});
if(process.env.SPINE_FAKE_CODEX_MODE==='wait') {setInterval(()=>{},1000);}
else if(process.env.SPINE_FAKE_CODEX_MODE==='fail') {
  emit({type:'turn.failed',error:{message:'fixture generation failed'}});process.exitCode=1;
} else if(process.env.SPINE_FAKE_CODEX_MODE==='no-apply') {
  emit({type:'item.completed',item:{type:'agent_message',text:'Fixture ended without applying.'}});
  emit({type:'turn.completed'});
} else {
  (async()=>{
    const fs=require('node:fs/promises');const {PNG}=require('pngjs');
    const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
    const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
    const setting=key=>JSON.parse(args.find(a=>a.startsWith(key+'=')).slice(key.length+1));
    const mcpArgs=setting('mcp_servers.spine-shelf.args');
    const taskId=mcpArgs[mcpArgs.indexOf('--task-id')+1];
    const client=new Client({name:'fake-worker-test',version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:setting('mcp_servers.spine-shelf.command'),args:mcpArgs,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'}));
    const call=async(name,params)=>{const r=await client.callTool({name:'spine_reskin_'+name,arguments:{taskId,...params}});if(r.isError)throw new Error(r.content[0].text);return r.structuredContent;};
    try {
      const context=await call('get_task',{});
      if(process.env.SPINE_FAKE_CODEX_PROGRESS_DELAY) {
        await call('update_task',{status:'processing',message:'已读取角色，正在生成机甲造型（测试进程）'});
        emit({type:'item.completed',item:{id:'fixture-note',type:'agent_message',text:'已读取角色，正在生成机甲造型（测试进程）'}});
        emit({type:'item.started',item:{id:'fixture-image',type:'mcp_tool_call',tool:'imagegen',status:'in_progress'}});
        await new Promise(resolve=>setTimeout(resolve,Number(process.env.SPINE_FAKE_CODEX_PROGRESS_DELAY)));
        emit({type:'item.completed',item:{id:'fixture-image',type:'mcp_tool_call',tool:'imagegen',status:'completed'}});
      }
      await call('update_task',{status:'processing',message:'自动化测试正在回填图块'});
      emit({type:'item.completed',item:{type:'agent_message',text:'自动化测试正在回填图块'}});
      for(const p of context.pages) {
        const png=PNG.sync.read(await fs.readFile(p.result));
        for(let i=0;i<png.data.length;i+=4){png.data[i]=Math.round(png.data[i]*0.2);png.data[i+1]=Math.round(png.data[i+1]*0.4);}
        await fs.writeFile(p.result,PNG.sync.write(png));
      }
      await call('apply',{});
      emit({type:'turn.completed'});
    } finally {await client.close();}
  })().catch(e=>{emit({type:'turn.failed',error:{message:e.message}});process.exitCode=1;});
}
