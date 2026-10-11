import {useEffect,useState} from 'react';
import {Sparkles,Play,X,LoaderCircle,ArrowRight,Plus,Trash2} from 'lucide-react';
import type {ReskinJob} from './types';
import ReskinProgress from './ReskinProgress';
import presets from '../electron/animation-presets.json';
const labels:Record<ReskinJob['status'],string>={queued:'等待开始',processing:'制作中',applying:'正在导入',completed:'已完成',failed:'需要处理',cancelled:'已取消'};
type ActionRow={id:string;name:string;description:string;label:string};
type Draft={name:string;prompt:string;actions:ActionRow[]};
const draftKey='spine-generation-draft-v2';
function readDraft():Draft {
  try {
    const saved=JSON.parse(localStorage.getItem(draftKey)||'null');
    if(saved&&typeof saved.name==='string'&&typeof saved.prompt==='string'&&Array.isArray(saved.actions)&&saved.actions.length<=32&&saved.actions.every((a:ActionRow)=>a&&['id','name','description','label'].every(k=>typeof a[k as keyof ActionRow]==='string')))return saved;
  }catch { /* A fresh form remains usable if local storage is unavailable. */ }
  return {name:'',prompt:'',actions:presets.map(a=>({...a,id:`preset-${a.name}`}))};
}
const restartMessage='制作功能已更新，请完全退出 Spine Shelf 后重新打开，载入新版本。当前填写内容会保留。';
export default function GenerationDialog({close,view}:{close:()=>void;view:(id:string)=>void}) {
  const [draft,setDraft]=useState<Draft>(readDraft);
  const {name,prompt,actions}=draft;
  const [compatible,setCompatible]=useState(false);
  const [jobs,setJobs]=useState<ReskinJob[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [codex,setCodex]=useState({ready:false,message:'正在检查 Codex…'});
  useEffect(()=>{try{localStorage.setItem(draftKey,JSON.stringify(draft));}catch{/* Storage may be unavailable. */}},[draft]);
  useEffect(()=>{
    let live=true,reading=false,timer:ReturnType<typeof setInterval>|undefined,off:(()=>void)|undefined;
    const refresh=async()=>{if(reading)return;reading=true;try {
      const [next,status]=await Promise.all([window.shelf.generationList(),window.shelf.reskinStatus()]);
      if(live){setJobs(next);setCodex(status.codex);}
    }catch(e){if(live)setError(String(e));}finally{reading=false;}};
    void (async()=>{
      try {
        if(typeof window.shelf.generationCapabilities!=='function'||typeof window.shelf.generationList!=='function')throw new Error('restart');
        const capabilities=await window.shelf.generationCapabilities();
        if(!capabilities.actionTable||(capabilities.rigVersion??0)<2)throw new Error('restart');
        if(!live)return;setCompatible(true);void refresh();
        timer=setInterval(refresh,3000);off=window.shelf.onReskinChange(()=>void refresh());
      }catch{if(live)setCodex({ready:false,message:restartMessage});}
    })();
    return()=>{live=false;clearInterval(timer);off?.();};
  },[]);
  const active=jobs.some(j=>['queued','processing','applying'].includes(j.status));
  const locked=busy||active;
  const invalidName=actions.findIndex(a=>!/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(a.name.trim()));
  const emptyContent=actions.findIndex(a=>!a.description.trim());
  const actionError=!actions.length?'请至少添加一个动作。':invalidName>=0?`第 ${invalidName+1} 行：动作名称需以英文字母开头，可使用数字、下划线和短横线。`:new Set(actions.map(a=>a.name.trim())).size!==actions.length?'动作名称不能重复。':emptyContent>=0?`第 ${emptyContent+1} 行：请填写动作内容。`:'';
  const editAction=(id:string,patch:Partial<ActionRow>)=>setDraft(d=>({...d,actions:d.actions.map(a=>a.id===id?{...a,...patch}:a)}));
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{try{setJobs(await window.shelf.generationList());}catch(e){setError(String(e));}setBusy(false);}};
  const create=()=>{if(actionError||locked||!compatible||!codex.ready)return;return run(()=>window.shelf.generationCreate({name,prompt,animationRequirements:actions.map(a=>({name:a.name.trim(),description:a.description.trim()}))}));};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <section className="modal generation-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-title">
      <button className="modal-close icon-btn" aria-label="关闭制作窗口" onClick={close}><X size={18}/></button>
      <div className="eyebrow">FROM IDEA TO ANIMATION</div>
      <h2 id="generation-title"><Sparkles size={23}/>AI 制作 Spine</h2>
      <p className="generation-intro">描述一个角色，让 Codex 绘制部件、搭建骨骼并制作动作，完成后直接加入资源库。</p>
      <div className="generation-format"><span>Spine 4.2</span><span>透明部件 · 骨骼动画</span><span>JSON + ATLAS + PNG</span></div>
      <form onSubmit={e=>{e.preventDefault();void create();}}>
        <label className="field"><span>角色名称</span><input autoFocus value={name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} maxLength={60} placeholder="例如：森林小骑士" required disabled={locked}/></label>
        <label className="field"><span>制作需求</span><textarea value={prompt} onChange={e=>setDraft(d=>({...d,prompt:e.target.value}))} maxLength={4000} rows={3} placeholder="描述角色的外观、风格和视角。例如：Q版森林骑士，苔绿色铠甲、木质盾牌，侧视角。具体动作在下方逐项填写。" required disabled={locked}/></label>
        <div className="generation-actions-heading"><h3 id="generation-actions-title">动作设计 <small>{actions.length} / 32</small></h3><button className="button" type="button" disabled={locked||actions.length>=32} onClick={()=>setDraft(d=>({...d,actions:[...d.actions,{id:crypto.randomUUID(),name:'',description:'',label:'自定义'}]}))}><Plus size={14}/>新增动作</button></div>
        <p className="reskin-help" id="generation-actions-help">每行动作单独制作，可修改或删除预设。动作名称是导出时的英文标识，动作内容可用中文描述。</p>
        <div className="generation-action-scroll">
          <table className="generation-action-table" aria-labelledby="generation-actions-title" aria-describedby="generation-actions-help">
            <thead><tr><th scope="col">动作名称</th><th scope="col">动作内容</th><th scope="col">操作</th></tr></thead>
            <tbody>{actions.map((action,index)=><tr key={action.id}>
              <td><span className="generation-action-label">{action.label}</span><input aria-label={`动作名称 ${index+1}`} value={action.name} maxLength={60} required disabled={locked} onChange={e=>editAction(action.id,{name:e.target.value})} placeholder="例如：jump"/></td>
              <td><textarea aria-label={`动作内容 ${index+1}`} value={action.description} maxLength={1000} rows={2} required disabled={locked} onChange={e=>editAction(action.id,{description:e.target.value})} placeholder="描述姿势、动作过程和结束状态…"/></td>
              <td><button className="icon-btn generation-action-delete" type="button" aria-label={`删除动作 ${index+1}`} title={`删除 ${action.name||'未命名动作'}`} disabled={locked} onClick={()=>setDraft(d=>({...d,actions:d.actions.filter(a=>a.id!==action.id)}))}><Trash2 size={15}/></button></td>
            </tr>)}</tbody>
          </table>
          {!actions.length&&<p className="generation-actions-empty">还没有动作，点击「新增动作」开始填写。</p>}
        </div>
        {actionError&&<p className="reskin-error" role="status">{actionError}</p>}
        <p className="reskin-help">按动作设计关节与重心，制作时检查关键姿势，完成后可预览检查。表单会自动保存。</p>
        <button className="button primary full-width" type="submit" disabled={locked||!compatible||!codex.ready||!name.trim()||!prompt.trim()||!!actionError}>{busy?<LoaderCircle size={16} className="spin"/>:<Play size={16}/>} {active?'正在制作角色':`开始制作 Spine · ${actions.length} 个动作`}</button>
      </form>
      <p className="reskin-help">{codex.ready?'使用已登录的 Codex 和图片生成额度。可关闭此面板，制作期间请保持软件打开。':codex.message}</p>
      {error&&<p className="reskin-error" role="alert">{error}</p>}
      <div className="generation-jobs">
        <h3>制作记录 <small>{jobs.length}</small></h3>
        {!jobs.length&&<p className="reskin-help">第一位新角色，从一段描述开始。</p>}
        {jobs.map(job=><article className={`reskin-job ${job.status}`} key={job.id}>
          <div className="reskin-job-heading"><strong>{job.name}</strong><span>{labels[job.status]}</span></div>
          <p className="reskin-current-message">{job.message}</p><ReskinProgress job={job}/>
          <div className="reskin-actions">
            {(job.status==='queued'||job.status==='failed'&&!active)&&<button className="button" disabled={busy||!codex.ready} onClick={()=>void run(()=>window.shelf.generationStart(job.id))}><Play size={14}/>{job.status==='queued'?'开始制作':'重新制作'}</button>}
            {['queued','processing'].includes(job.status)&&<button className="text-button" disabled={busy} onClick={()=>void run(()=>window.shelf.generationCancel(job.id))}>取消制作</button>}
            {job.status==='completed'&&<button className="button" onClick={()=>view(job.assetId)}>查看角色<ArrowRight size={14}/></button>}
          </div>
        </article>)}
      </div>
    </section>
  </div>;
}
