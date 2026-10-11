const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { parse } = require('smol-toml');
const { eventEntry, visibleText } = require('./reskin-progress.cjs');
const exec = promisify(execFile);

function childEnvironment(source = process.env) {
  const env = { ...source };
  // A nested Codex session must use its saved login, not the desktop host's
  // per-turn token, transport, session identity or Electron Node-mode flag.
  for (const key of Object.keys(env)) if (key.startsWith('CODEX_') && !['CODEX_HOME','CODEX_CLI_PATH','CODEX_MCP_NODE_PATH'].includes(key)) delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENAI_API_KEY;
  return env;
}
async function findCodex(env = process.env) {
  const candidates = [env.SPINE_SHELF_CODEX, env.CODEX_CLI_PATH];
  if (process.platform === 'darwin') candidates.push(
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(os.homedir(),'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'));
  if (process.platform === 'win32') {
    const bin = path.join(env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'OpenAI','Codex','bin');
    candidates.push(path.join(bin,'codex.exe'));
    try {
      const entries = await fs.readdir(bin,{withFileTypes:true});
      const installed = await Promise.all(entries.filter(entry=>entry.isDirectory()).map(async entry=>{
        const file=path.join(bin,entry.name,'codex.exe');
        try { return {file,modified:(await fs.stat(file)).mtimeMs}; } catch { return null; }
      }));
      candidates.push(...installed.filter(Boolean).sort((a,b)=>b.modified-a.modified).map(entry=>entry.file));
    } catch { /* Desktop app is not installed in this location. */ }
  }
  for (const dir of (env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir,process.platform === 'win32' ? 'codex.exe' : 'codex'));
  candidates.push(path.join(os.homedir(),'.local/bin/codex'));
  for (const file of candidates.filter(Boolean)) {
    try { await fs.access(file,fs.constants.X_OK); return file; } catch { /* Next installed location. */ }
  }
  throw new Error('未找到 Codex，请先安装或更新 ChatGPT / Codex 桌面版。');
}
function briefError(value) {
  const text = String(value || '').replace(/\x1b\[[0-9;]*m/g,'');
  if (/401|unauthorized|authentication|not logged in|invalid_api_key/i.test(text)) return 'Codex 登录已失效，请在 Codex 中重新登录后重试。';
  if (/429|quota|usage limit|rate limit/i.test(text)) return 'Codex 当前额度或请求次数已达限制，请稍后重试。';
  if (/sandbox|operation not permitted|permission denied/i.test(text)) return 'Codex 无法访问所需文件，请检查任务日志中的权限错误后重试。';
  return text.slice(0,800) || 'Codex 未完成制作，请重试。';
}
class CodexRunner {
  constructor({ service, enqueue, userData, mcpExecutable = process.execPath, mcpScript = path.join(__dirname,'mcp-server.cjs'), env = process.env, spawnProcess = spawn }) {
    Object.assign(this,{service,enqueue,userData,mcpExecutable,mcpScript,env,spawnProcess});
    this.runs = new Map(); this.check = null; this.closed = false;
  }
  async init() {
    for (const job of this.service.jobs) if (job.execution?.state === 'running') {
      job.execution.state = 'interrupted';
      if (['queued','processing'].includes(job.status)) {
        job.status = 'failed'; job.message = '上次制作因软件退出而中断，可以重试。';
        job.execution.endedAt = new Date().toISOString();
        job.updatedAt = job.execution.endedAt;
        await this.service.progress.record(job,{kind:'error',status:'failed',text:job.message});
      }
      await this.service.progress.settle(job);
    }
    await this.service.save();
  }
  async status(refresh = false) {
    if (!refresh && this.check && Date.now()-this.check.at < 10000) return this.check.value;
    let value;
    try {
      const command = await findCodex(this.env), env = childEnvironment(this.env);
      const options = {env,timeout:15000,maxBuffer:100000,windowsHide:true};
      const [help,login] = await Promise.all([exec(command,['exec','--help'],options),exec(command,['login','status'],options)]);
      if (!help.stdout.includes('--ignore-user-config')) throw new Error('本机 Codex 版本较旧，请更新 ChatGPT / Codex 桌面版。');
      if (!/Logged in using ChatGPT/i.test(login.stdout+login.stderr)) throw new Error('请先在 Codex 中使用 ChatGPT 账号登录，再回来制作。');
      value = { ready:true, command, message:'Codex 已就绪' };
    } catch (e) { value = { ready:false, message:briefError(e.stderr || e.message) }; }
    this.check = {at:Date.now(),value}; return value;
  }
  async configuration() {
    const home = this.env.CODEX_HOME || path.join(os.homedir(),'.codex');
    let config = {};
    try { config = parse(await fs.readFile(path.join(home,'config.toml'),'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Codex 配置无法读取，请先修复配置后重试。'); }
    if (config.model_provider && config.model_provider !== 'openai') throw new Error('直接换肤需要 Codex 的 ChatGPT 登录与内置图片工具，请先切回 OpenAI 提供方。');
    return { home, model:config.model, effort:config.model_reasoning_effort, windowsSandbox:config.windows?.sandbox === 'unelevated' ? 'unelevated' : 'elevated' };
  }
  async start(id) {
    if (this.closed) throw new Error('软件正在退出，请重新打开后重试。');
    const health = await this.status(true);
    if (!health.ready) throw new Error(health.message);
    const config = await this.configuration();
    const run = await this.enqueue(async () => {
      const job = this.service.task(id);
      if (this.runs.has(id)) throw new Error('这个任务已经在制作中。');
      if (!['queued','failed'].includes(job.status)) throw new Error('这个任务不能再次启动。');
      if (!this.service.generation && await this.service.digest(this.service.library.asset(job.assetId)) !== job.sourceDigest) throw new Error('原资源已经变化，请取消旧任务并重新创建。');
      const run = { id, token:randomUUID(), child:null, lastMessage:'', failure:'', turnCompleted:false, logBytes:0 };
      job.execution = {runId:run.token,state:'running',startedAt:new Date().toISOString()};
      await this.service.update(id,'processing','正在启动 Codex…');
      this.runs.set(id,run); return run;
    });
    const job = this.service.task(id), cwd = this.service.dir(job);
    // Select the current permission profile explicitly. The legacy --sandbox
    // flag alone can leave newer CLI sessions on their default read-only profile.
    const args = ['-a','never','exec','--ignore-user-config','--json','--skip-git-repo-check','-c','default_permissions=":workspace"','-C',cwd];
    if (process.platform === 'win32') args.push('-c',`windows.sandbox=${JSON.stringify(config.windowsSandbox)}`);
    if (typeof config.model === 'string') args.push('-m',config.model);
    if (typeof config.effort === 'string') args.push('-c',`model_reasoning_effort=${JSON.stringify(config.effort)}`);
    const mcpArgs = [this.mcpScript,'--data-dir',this.userData,'--task-id',id,'--run-id',run.token];
    if (this.service.generation) mcpArgs.push('--task-kind','generation');
    args.push('-c',`mcp_servers.spine-shelf.command=${JSON.stringify(this.mcpExecutable)}`,
      '-c',`mcp_servers.spine-shelf.args=${JSON.stringify(mcpArgs)}`,
      '-c','mcp_servers.spine-shelf.env.ELECTRON_RUN_AS_NODE="1"',
      '-c','mcp_servers.spine-shelf.required=true','-');
    const skillPath = path.join(config.home,'skills/spine-reskin/SKILL.md');
    const hasSkill = await fs.access(skillPath).then(()=>true,()=>false);
    const skillInstruction = hasSkill ? `可读取 ${skillPath} 中的补充制作流程。` : '本机未安装 spine-reskin 技能，无需读取或搜索此技能文件；直接遵循本任务和 MCP 返回的制作流程。';
    const prompt = this.service.generation ? `${this.service.handoff(id)}\n这是用户点击「开始制作」后启动的任务，请直接执行。图片使用内置 image_gen.imagegen；缺少此工具时报告实际原因，不改用额外 API Key 接口。先 get_task 阅读 manifest 与 schema，制作所有要求的动作，不提交示例占位内容。` : `${this.service.handoff(id)}\n\n这是用户在 Spine Shelf 中点击「开始制作」后自动启动的任务。请直接完成，不要求用户再次复制内容或确认启动。使用内置 image_gen.imagegen；不要改用需要额外 API Key 的图片接口。${skillInstruction}所有制作文件放在当前任务目录，source 快照只读。你可解包/重采样/回填图块，但造型重绘需使用内置图片工具。不要直接写 Library 索引或原资源。定期通过 spine_reskin_update_task 报告用户能理解的进度；读取附件、开始图片生成、生成返回、回填贴图、检查结果和提交前各报告一次，说明已完成什么和正在做什么，不编造百分比。耗时工具执行前先报告正在等待什么。全部图片校验完成后调用 spine_reskin_apply。若缺少能力或失败，报告 failed 和实际原因；不得把部分结果当作成功。任务目录已经有结果模板，直接开始。`;
    run.log = path.join(cwd,'codex-events.jsonl');
    try {
      await fs.writeFile(run.log,'');
      if(job.execution.state!=='running' || this.closed) throw new Error('任务已取消或软件正在退出。');
      const child = run.child = this.spawnProcess(health.command,args,{cwd,env:childEnvironment(this.env),stdio:['pipe','pipe','pipe'],detached:process.platform !== 'win32',windowsHide:true});
      let buffer = '', stderr = '';
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk => {
        buffer += chunk;
        let newline;
        while ((newline=buffer.indexOf('\n')) >= 0) {
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
          try { this.event(run,JSON.parse(line)); } catch { /* Ignore non-protocol output. */ }
        }
        if (buffer.length>2*1024*1024) buffer='';
      });
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
      child.stdin.on('error',()=>{});
      run.done = new Promise(resolve=> {
        child.once('error',error=>{run.failure=error.message;});
        child.once('close',(code,signal)=> {this.finish(run,code,signal,stderr).catch(()=>{}).finally(resolve);});
      });
      child.stdin.end(prompt);
      return this.service.task(id);
    } catch (e) {
      await this.finish(run,1,null,e.message); throw e;
    }
  }
  event(run,event) {
    const item = event.item || {};
    const entry = eventEntry(event);
    if(this.service.generation && event.type==='turn.started' && entry)entry.text='开始读取 Spine 制作需求';
    // Keep a bounded diagnostic log without raw command output, image bytes or reasoning.
    const record={at:new Date().toISOString(),type:event.type,itemType:item.type,status:item.status,tool:item.tool || item.name};
    if (item.type==='agent_message') record.text=visibleText(item.text);
    if (event.type==='thread.started') record.threadId=event.thread_id;
    if (event.type==='turn.failed' || event.type==='error') record.error=briefError(event.error?.message || event.message);
    const line=JSON.stringify(record)+'\n';
    if(run.logBytes<2*1024*1024) {run.logBytes+=Buffer.byteLength(line);run.logQueue=(run.logQueue||Promise.resolve()).then(()=>fs.appendFile(run.log,line)).catch(()=>{});}
    if (event.type==='turn.completed') run.turnCompleted=true;
    if (event.type==='turn.failed') run.failure=briefError(event.error?.message || event.message);
    if (item.type==='agent_message' && item.text) run.lastMessage=visibleText(item.text,1000);
    let message;
    if(event.type==='turn.started') message=this.service.generation?'Codex 正在读取 Spine 制作需求…':'Codex 正在读取角色与换肤要求…';
    if(item.type==='agent_message' && item.text && event.type==='item.completed') message=run.lastMessage;
    if(entry || event.type==='thread.started') void this.enqueue(async()=> {
      const job=this.service.task(run.id);
      if(job.execution?.runId!==run.token || job.execution.state!=='running') return;
      if(event.thread_id) {job.execution.threadId=event.thread_id;await this.service.save();}
      if(message && job.status==='processing') await this.service.update(run.id,'processing',message,false);
      if(entry) await this.service.progress.record(job,{...entry,...(item.id ? {id:`${run.token}:${item.id}`} : {})});
    }).catch(()=>{});
  }
  async details(id) {
    const job=this.service.task(id), progress=await this.service.progress.load(job);
    const child=this.runs.get(id)?.child;
    return {job,...structuredClone(progress),running:!!child && child.exitCode===null && !child.signalCode};
  }
  async finish(run,code,signal,stderr) {
    await this.enqueue(async()=> {
      const job=this.service.task(run.id);
      if(job.execution?.runId!==run.token) return;
      job.execution.state=job.status==='completed'?'completed':job.status==='cancelled'?'cancelled':'failed';
      job.execution.endedAt=new Date().toISOString();
      if(['queued','processing'].includes(job.status)) {
        const reason=run.failure || (code!==0 ? stderr || `Codex 进程退出（${signal || code}）。` : `尚未提交完成的${this.service.generation?'Spine':'皮肤'}。${run.lastMessage}`);
        await this.service.update(run.id,'failed',briefError(reason));
      } else {await this.service.save();this.service.changed(false);}
      await this.service.progress.settle(job);
    });
    await run.logQueue;
    if(this.runs.get(run.id)===run) this.runs.delete(run.id);
  }
  async stopProcess(run) {
    const child=run?.child;if(!child || child.exitCode!==null) return;
    const kill = signal => {
      try {
        if(process.platform==='win32') child.kill(signal);
        else process.kill(-child.pid,signal);
      } catch { /* Already exited. */ }
    };
    kill('SIGTERM');
    let timer;
    await Promise.race([run.done,new Promise(resolve=>{timer=setTimeout(()=>{kill('SIGKILL');resolve();},3000);})]);
    clearTimeout(timer);
  }
  async cancel(id) {
    const run=this.runs.get(id);
    await this.enqueue(async()=> {
      const job=this.service.task(id);
      if(job.execution)job.execution.state='cancelled';
      await this.service.update(id,'cancelled');
    });
    await this.stopProcess(run);return this.service.task(id);
  }
  async shutdown() {
    this.closed=true;
    await Promise.all([...this.runs.values()].map(async run=> {
      await this.enqueue(async()=> {
        const job=this.service.task(run.id);
        if(job.execution?.runId!==run.token)return;
        if(job.execution.state==='running')job.execution.state='interrupted';
        if(job.status==='processing')await this.service.update(run.id,'failed','制作因软件退出而中断，可以重试。');
        else await this.service.save();
      });
      await this.stopProcess(run);
    }));
  }
}
module.exports = {CodexRunner,childEnvironment,findCodex};
