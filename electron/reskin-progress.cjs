const fs = require('node:fs/promises');
const path = require('node:path');

function visibleText(value, limit = 3000) {
  return String(value || '').replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[a-zA-Z0-9_-]{16,}/g, '[已隐藏]')
    .slice(0, limit);
}
const toolLabels = {
  spine_reskin_get_task: '读取角色与换肤要求',
  spine_reskin_read_image: '查看角色贴图',
  spine_reskin_update_task: '更新制作进度',
  spine_reskin_apply: '校验并添加新皮肤',
};
// Only user-facing messages and operation metadata cross into the UI.
// Do not retain reasoning, commands, command output, tool arguments or image data.
function eventEntry(event) {
  const item = event.item || {}, type = item.type || '';
  if (type === 'agent_message' && item.text && event.type === 'item.completed')
    return {kind:'message',status:'info',text:visibleText(item.text)};
  if (event.type === 'turn.failed' || event.type === 'error')
    return {kind:'error',status:'failed',text:visibleText(event.error?.message || event.message || 'Codex 返回错误')};
  if (event.type === 'thread.started') return {kind:'status',status:'info',text:'已连接 Codex'};
  if (event.type === 'turn.started') return {kind:'status',status:'info',text:'开始读取角色与换肤要求'};
  if (event.type === 'turn.completed') return {kind:'status',status:'info',text:'Codex 本轮处理结束'};
  if (!['item.started','item.completed'].includes(event.type)) return null;
  const tool = visibleText(item.tool || item.name || '', 160);
  let text;
  if (/image_generation|imagegen/.test(`${type} ${tool}`)) text = '生成新造型';
  else if (type === 'command_execution') text = '执行本地素材处理';
  else if (type === 'mcp_tool_call' || type === 'dynamic_tool_call') text = toolLabels[tool] || `调用工具${tool ? `：${tool}` : ''}`;
  else if (type === 'file_change') text = '更新制作文件';
  else if (type === 'web_search') text = '查阅资料';
  else return null;
  const failed = item.status === 'failed' || item.error || item.result?.isError || (typeof item.exit_code === 'number' && item.exit_code !== 0);
  const entry = {kind:'tool',text,status:failed ? 'failed' : event.type === 'item.started' ? 'running' : 'completed'};
  if (tool) entry.tool = tool;
  if (typeof item.exit_code === 'number') entry.exitCode = item.exit_code;
  if (item.error?.message) entry.detail = visibleText(item.error.message, 800);
  return entry;
}
class ReskinProgress {
  constructor(service) { this.service = service; this.cache = new Map(); }
  async load(job) {
    if (this.cache.has(job.id)) return this.cache.get(job.id);
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(this.service.dir(job),'progress.json'),'utf8')); }
    catch(e) {
      if (e.code !== 'ENOENT') throw e;
      data = {entries:[],trimmed:0};
      // Old releases saved visible Codex messages but no timestamps. Preserve
      // them without making up timing or completed tool pairs.
      try {
        const old = await fs.readFile(path.join(this.service.dir(job),'codex-events.jsonl'),'utf8');
        for (const line of old.split('\n')) {
          let r; try {r = JSON.parse(line);} catch {continue;}
          const entry = eventEntry({type:r.type,message:r.error,item:{type:r.itemType,status:r.status,tool:r.tool,text:r.text}});
          if (entry) data.entries.push({...entry,id:`legacy-${data.entries.length}`,legacy:true});
        }
      } catch(e) {if (e.code !== 'ENOENT') throw e;}
      data.trimmed = Math.max(0,data.entries.length-500);
      data.entries = data.entries.slice(-500);
      if (data.entries.length) for (const entry of data.entries) if (entry.status === 'running') entry.status = 'info';
    }
    this.cache.set(job.id,data);return data;
  }
  async record(job, entry) {
    const data = await this.load(job), now = new Date().toISOString();
    const previous = entry.id && data.entries.find(e=>e.id===entry.id);
    if (previous) Object.assign(previous,entry,{updatedAt:now});
    else data.entries.push({...entry,id:entry.id || require('node:crypto').randomUUID(),at:now,updatedAt:now});
    if (data.entries.length>500) {data.trimmed += data.entries.length-500;data.entries.splice(0,data.entries.length-500);}
    const file = path.join(this.service.dir(job),'progress.json');
    await fs.writeFile(file+'.tmp',JSON.stringify(data));await fs.rename(file+'.tmp',file);
    this.service.changed(false);
  }
  async settle(job) {
    const data = await this.load(job);
    for (const entry of data.entries.filter(e=>e.status==='running'))
      await this.record(job,{...entry,status:'info',detail:'本轮执行已结束，未收到此操作的完成记录。'});
  }
}
module.exports = {ReskinProgress,eventEntry,visibleText};
