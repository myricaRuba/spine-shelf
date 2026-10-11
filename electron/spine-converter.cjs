const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {detectVersion, SUPPORTED} = require('./library.cjs');
const {safeFile} = require('./reskin.cjs');

const TARGETS = ['original', ...SUPPORTED];
const check = (ok, message) => {if (!ok) throw new Error(message);};
function targetVersion(options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options), '导出选项无效。');
  const target = options.targetVersion ?? 'original';
  check(TARGETS.includes(target), '请选择支持的 Spine 目标版本。');
  return target;
}
function exportAction(version, target) {
  if (target === 'original') return {action:'copy', message:'保留原版本'};
  const match = /^(\d+\.\d+)\.\d+$/.exec(version);
  if (!match || !SUPPORTED.includes(match[1])) return {action:'blocked', message:`无法转换版本 ${version}，请使用稳定版 Spine 重新导出`};
  const source = match[1];
  if (SUPPORTED.indexOf(source) > SUPPORTED.indexOf(target)) return {action:'blocked', message:`${source} → ${target} 属于降级，可能丢失动画数据，暂不自动转换`};
  if (source === target && version !== '3.8.75') return {action:'copy', message:`已匹配 Spine ${target}，保留原数据`};
  return {action:'convert', message:source === target ? '重新导出为 Spine 3.8.99' : `通过 Spine 转换为 ${target}`};
}
function redact(text) {
  return String(text).replace(/^.*(?:licensed to|license key|activation code|激活码|授权给).*$/gim, '[授权信息已隐藏]');
}
function processFailure(log) {
  if (/Version cannot be null|<needs update>/i.test(log)) return 'Spine 启动器未能加载所需编辑器版本。请先在 Spine 中确认该版本可以打开并导出，再重试。';
  if (/access.*denied|error code 5|BackingStoreException/i.test(log)) return 'Spine 启动器无法读写它的本机配置。请先修复 Spine 安装并确认可以正常导出。';
  return log.split(/\r?\n/).filter(line=>!/^\s*at /.test(line)).slice(-12).join('\n').slice(-2000);
}
function runProcess(executable, args, {cwd, timeoutMs = 120000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, shell:false, windowsHide:true, stdio:['ignore','pipe','pipe']});
    let output = '', timedOut = false;
    const receive = bytes => {output = (output + bytes.toString()).slice(-24000);};
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const timer = setTimeout(() => {
      timedOut = true;
      if(process.platform==='win32' && child.pid) {
        // Spine.com can start a Java child. Terminate only this invocation's process tree.
        const killer=spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
        killer.once('error',()=>child.kill());
      } else child.kill();
    }, timeoutMs);
    child.once('error', error => {clearTimeout(timer); reject(new Error(`无法启动 Spine：${error.message}`));});
    child.once('close', code => {
      clearTimeout(timer);
      const log = redact(output).trim();
      if (timedOut) reject(new Error('Spine 转换超时。请先在 Spine 中准备好源版本和目标版本，再重试。'));
      else if (code !== 0) reject(new Error(`Spine 命令执行失败（${code}）。${log ? '\n' + processFailure(log) : '请检查编辑器能否正常导出。'}`));
      else resolve(log);
    });
  });
}

class SpineConverter {
  constructor({settingsFile, executable = '', run = runProcess, platform = process.platform, env = process.env} = {}) {
    this.settingsFile = settingsFile; this.executable = executable; this.run = run; this.platform = platform; this.env = env;
  }
  async init() {
    if (!this.settingsFile) return;
    try {this.executable = JSON.parse(await fs.readFile(this.settingsFile,'utf8')).executable || '';}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  async resolveExecutable(candidate) {
    check(typeof candidate === 'string' && path.isAbsolute(candidate), '请选择 Spine 安装目录里的命令行程序。');
    let file = candidate;
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, this.platform === 'win32' ? 'Spine.com' : 'Spine');
    if (this.platform === 'win32') {
      if (/\.exe$/i.test(file)) file = path.join(path.dirname(file), 'Spine.com');
      check(/\.com$/i.test(file), 'Windows 下请选择 Spine.com（与 Spine.exe 位于同一目录）。');
    }
    file = await fs.realpath(file);
    check((await fs.stat(file)).isFile(), 'Spine 命令行程序不存在。');
    return file;
  }
  async findExecutable() {
    if (this.executable) return this.resolveExecutable(this.executable);
    const candidates = [this.env.SPINE_SHELF_SPINE];
    if (this.platform === 'win32') {
      for (const base of [this.env.ProgramFiles, this.env['ProgramFiles(x86)'], this.env.LOCALAPPDATA && path.join(this.env.LOCALAPPDATA,'Programs')]) {
        if (base) candidates.push(path.join(base,'Spine','Spine.com'));
      }
    } else if (this.platform === 'darwin') candidates.push('/Applications/Spine/Spine.app/Contents/MacOS/Spine');
    for (const base of (this.env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(base, this.platform === 'win32' ? 'Spine.com' : 'Spine'));
    for (const file of candidates.filter(Boolean)) {try {return await this.resolveExecutable(file);} catch {}}
    throw new Error('需要连接本机 Spine 编辑器，才能转换骨骼版本。');
  }
  async status() {
    try {return {available:true, path:await this.findExecutable(), message:'已连接 Spine；转换时会调用所需的编辑器版本。'};}
    catch (error) {return {available:false, path:this.executable, message:error.message};}
  }
  async configure(candidate) {
    const executable = await this.resolveExecutable(candidate);
    const help = await this.run(executable, ['--help'], {cwd:path.dirname(executable), timeoutMs:15000});
    check(/Spine/i.test(help) && /--import/.test(help) && /--export/.test(help) && /--update/.test(help), '该程序未提供所需的 Spine 转换命令。');
    if (this.settingsFile) {
      await fs.mkdir(path.dirname(this.settingsFile), {recursive:true});
      const temp = this.settingsFile + '.' + randomUUID() + '.tmp';
      try {await fs.writeFile(temp, JSON.stringify({executable},null,2)); await fs.rename(temp, this.settingsFile);}
      finally {await fs.rm(temp,{force:true});}
    }
    this.executable = executable;
    return this.status();
  }
  async convert({input, format, version, target, directory, forceJson=false}) {
    const action=exportAction(version,target).action;
    check(action==='convert' || (forceJson && format==='skel' && action==='copy'), '这份素材不需要或不支持所选版本转换。');
    const preserveVersion=target==='original',runtime=preserveVersion?version.split('.').slice(0,2).join('.'):target;
    const executable = await this.findExecutable();
    const work = await fs.mkdtemp(path.join(directory,'convert-'));
    try {
      const source = path.join(work,`skeleton.${format}`), project = path.join(work,'skeleton.spine'), output = path.join(work,'output');
      await fs.copyFile(input,source); await fs.mkdir(output);
      // Import with the source editor first, then open that project with the target editor.
      // Exported JSON/SKEL data cannot be imported directly by a different minor version.
      const sourceEditor = version;
      const targetEditor = preserveVersion?version:target === '3.8' ? '3.8.99' : `${target}.xx`;
      await this.run(executable,['-u',sourceEditor,'-i',source,'-o',project,'--import','skeleton'],{cwd:work});
      check(await fs.stat(project).then(s=>s.isFile() && s.size>0).catch(()=>false), `Spine ${sourceEditor} 没有生成中间工程。请先确认此版本可以正常导入素材。`);
      const settings = path.join(work,'export-settings.json');
      await fs.writeFile(settings,JSON.stringify({class:runtime === '3.8' ? 'json' : 'export-json',extension:'.json',format:'JSON',nonessential:true,prettyPrint:true,cleanUp:false,packAtlas:null,open:false}));
      const log = await this.run(executable,['-u',targetEditor,'-i',project,'-o',output,'--export',settings],{cwd:work});
      const bytes = await fs.readFile(await safeFile(output,'skeleton.json')).catch(()=>{throw new Error(`Spine ${targetEditor} 没有生成 skeleton.json。请确认目标编辑器已就绪。\n${log.slice(-1500)}`);});
      const json = JSON.parse(bytes.toString('utf8'));
      const actual = detectVersion(bytes,json);
      check(preserveVersion?actual===version:new RegExp(`^${runtime.replace('.','\\.')}\\.\\d+$`).test(actual) && actual !== '3.8.75', `转换结果版本不匹配：要求 ${preserveVersion?version:target}，实际 ${actual || '未知'}。未生成导出包。`);
      return {bytes, json, version:actual, runtime, format:'json', converted:true};
    } finally {await fs.rm(work,{recursive:true,force:true});}
  }
}

module.exports = {SpineConverter, TARGETS, targetVersion, exportAction, runProcess};
