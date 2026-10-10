import {useEffect,useState} from "react";
import {FolderPlus,Plus,Trash2,X} from "lucide-react";
import {assetUrl,CATEGORY_LABELS,type Library,type ProjectAction,type ProjectInput,type ProjectExportProgress} from "./types";

export type ProjectDialogState = {mode:"create"|"settings"|"picker"|"assign"|"member"|"export";projectId?:string;assetIds?:string[]};
export default function ProjectDialogs({state,library,close,mutate,onCreated,onExport,exportProgress}: {
  state:ProjectDialogState;library:Library;close:()=>void;
  mutate:(action:ProjectAction,input:ProjectInput)=>Promise<string>;
  onCreated:(id:string)=>void;onExport:(id:string)=>Promise<void>;
  exportProgress:ProjectExportProgress|null;
}) {
  const project=library.projects.find(p=>p.id===state.projectId);
  const [name,setName]=useState(project?.name || "");
  const [note,setNote]=useState(project?.note || "");
  const [target,setTarget]=useState(state.projectId || library.projects[0]?.id || "");
  const targetProject=library.projects.find(p=>p.id===target);
  const member=project?.members.find(m=>m.assetId===state.assetIds?.[0]);
  const asset=library.assets.find(a=>a.id===state.assetIds?.[0]);
  const [category,setCategory]=useState(member?.categoryId || "");
  const [skin,setSkin]=useState(member?.skin || "");
  const [label,setLabel]=useState(member?.label || "");
  const [memberNote,setMemberNote]=useState(member?.note || "");
  const [categoryName,setCategoryName]=useState("");
  const [search,setSearch]=useState("");
  const [checked,setChecked]=useState<string[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [confirmRemove,setConfirmRemove]=useState(false);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape' && !busy)close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,close]);
  const run=async(action:()=>Promise<unknown>,finish=true)=>{
    setBusy(true);setError("");try{await action();if(finish)close();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const title=({create:'新建项目',settings:'项目设置',picker:'从资源库添加',assign:'加入项目',member:'项目中的素材',export:'导出项目'})[state.mode];
  const chooseCategory=(categories=targetProject?.categories || [])=><label className="field"><span>项目分类</span><select aria-label="项目分类" value={category} onChange={e=>setCategory(e.target.value)}>
    {state.mode!=='member' && <option value="">按资源分类自动分配</option>}{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
  </select></label>;
  const available=library.assets.filter(a=>[a.name,...a.tags].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget && !busy)close();}}>
    <section className={`modal project-dialog project-dialog-${state.mode}`} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
      <button className="modal-close icon-btn" aria-label="关闭项目弹窗" onClick={close} disabled={busy}><X size={18}/></button>
      <span className="modal-symbol"><FolderPlus size={23}/></span><h2 id="project-dialog-title">{title}</h2>
      {['create','settings'].includes(state.mode) && <form onSubmit={e=>{e.preventDefault();void run(async()=>{
        const id=await mutate(state.mode==='create'?'create':'rename',{projectId:project?.id,name,note});if(state.mode==='create')onCreated(id);
      });}}>
        <label className="field"><span>项目名称</span><input autoFocus aria-label="项目名称" value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="例如：森林冒险" required/></label>
        <label className="field"><span>项目备注</span><textarea aria-label="项目备注" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} placeholder="记录游戏主题或这批素材的用途"/></label>
        {state.mode==='create' && <p className="modal-description">创建后，从资源库挑选素材，按人物、地形、道具、特效、界面和其他整理。</p>}
        <div className="modal-actions"><button className="button primary" disabled={busy || !name.trim()}>{state.mode==='create'?'创建项目':'保存项目'}</button></div>
      </form>}
      {state.mode==='settings' && project && <>
        <div className="project-settings-categories"><h3>项目分类</h3>
          {project.categories.map(c=><div className="project-category-edit" key={c.id}>
            <input aria-label={`分类名称 ${c.name}`} defaultValue={c.name} maxLength={30} onBlur={e=>{
              const value=e.target.value;if(value!==c.name)void run(()=>mutate('category',{projectId:project.id,categoryId:c.id,name:value}),false);
            }}/>
            <span>{project.members.filter(m=>m.categoryId===c.id).length} 份</span>
            <button className="icon-btn" disabled={busy || c.id==='other' || project.members.some(m=>m.categoryId===c.id)} aria-label={`删除分类 ${c.name}`} title="仅可删除没有素材的分类" onClick={()=>void run(()=>mutate('removeCategory',{projectId:project.id,categoryId:c.id}),false)}><X size={14}/></button>
          </div>)}
          <form className="project-category-edit" onSubmit={e=>{e.preventDefault();void run(async()=>{await mutate('category',{projectId:project.id,name:categoryName});setCategoryName('');},false);}}>
            <input aria-label="新分类名称" value={categoryName} onChange={e=>setCategoryName(e.target.value)} maxLength={30} placeholder="新增分类，如怪物、建筑"/>
            <button className="text-button" disabled={busy || !categoryName.trim()}><Plus size={14}/>添加分类</button>
          </form>
        </div>
        <div className="project-delete">
          {confirmRemove ? <><p>删除「{project.name}」及其整理记录？资源库中的素材仍会保留。</p><button className="button danger" disabled={busy} onClick={()=>void run(async()=>{await mutate('remove',{projectId:project.id});onCreated('');})}>确认删除项目</button><button className="text-button" onClick={()=>setConfirmRemove(false)}>取消</button></> : <button className="text-button" onClick={()=>setConfirmRemove(true)}><Trash2 size={13}/>删除项目</button>}
        </div>
      </>}
      {state.mode==='assign' && <>
        <p className="modal-description">将 {state.assetIds?.length || 0} 份素材加入项目。同一素材可以用于多个项目。</p>
        {library.projects.length ? <>
          <label className="field"><span>目标项目</span><select aria-label="目标项目" value={target} onChange={e=>{setTarget(e.target.value);setCategory('');}}>{library.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {chooseCategory()}
          <p className="project-hint">已加入的素材会保留原来的项目设置。</p>
          <div className="modal-actions"><button className="button primary" disabled={busy || !target} onClick={()=>void run(()=>mutate('add',{projectId:target,assetIds:state.assetIds,categoryId:category || undefined}))}>加入项目</button></div>
        </> : <p className="modal-description">先从左侧「游戏项目」新建一个项目，再加入素材。</p>}
      </>}
      {state.mode==='picker' && project && <>
        <p className="modal-description">添加到「{project.name}」</p>
        <input className="project-picker-search" aria-label="查找待添加素材" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索素材名称或标签"/>
        {chooseCategory(project.categories)}
        <div className="project-picker-summary"><span>已选 {checked.length} 份</span><button className="text-button" onClick={()=>setChecked([...new Set([...checked,...available.filter(a=>!project.members.some(m=>m.assetId===a.id)).map(a=>a.id)])])}>选择搜索结果</button><button className="text-button" onClick={()=>setChecked([])}>清空选择</button></div>
        <div className="project-picker-list">{available.map(a=>{
          const added=project.members.some(m=>m.assetId===a.id);
          return <label key={a.id} className={added?'already-added':''}>
            <input type="checkbox" aria-label={`添加 ${a.name}`} checked={added || checked.includes(a.id)} disabled={added || busy} onChange={e=>setChecked(e.target.checked?[...checked,a.id]:checked.filter(id=>id!==a.id))}/>
            {a.thumbnail ? <img src={assetUrl(a,'thumbnail.png')} alt=""/> : <span className="project-picker-placeholder"><FolderPlus size={20}/></span>}
            <span><strong>{a.name}</strong><small>{CATEGORY_LABELS[a.category]} · Spine {a.version}</small></span>{added && <em>已加入</em>}
          </label>;
        })}{!available.length && <p className="project-hint">没有找到匹配的素材。</p>}</div>
        <div className="modal-actions"><button className="button primary" disabled={busy || !checked.length} onClick={()=>void run(()=>mutate('add',{projectId:project.id,assetIds:checked,categoryId:category || undefined}))}>添加 {checked.length} 份素材</button></div>
      </>}
      {state.mode==='member' && project && member && asset && <>
        <p className="modal-description">{project.name} · {asset.name}</p>
        <label className="field"><span>项目内名称</span><input aria-label="项目内名称" value={label} onChange={e=>setLabel(e.target.value)} placeholder={asset.name} maxLength={60}/></label>
        {chooseCategory(project.categories)}
        <label className="field"><span>导出皮肤</span><select aria-label="项目导出皮肤" value={skin} onChange={e=>setSkin(e.target.value)}>{asset.skins.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="field"><span>用途备注</span><textarea aria-label="项目素材备注" value={memberNote} onChange={e=>setMemberNote(e.target.value)} maxLength={2000} placeholder="例如：玩家角色、第一关地形"/></label>
        <div className="modal-actions"><button className="button primary" disabled={busy} onClick={()=>void run(()=>mutate('member',{projectId:project.id,assetId:asset.id,categoryId:category,skin,label,note:memberNote}))}>保存素材设置</button></div>
      </>}
      {state.mode==='export' && project && <>
        <p className="modal-description">将「{project.name}」导出为 ZIP 通用素材包。</p>
        <div className="project-export-counts">{project.categories.filter(c=>project.members.some(m=>m.categoryId===c.id)).map(c=><span key={c.id}>{c.name}<strong>{project.members.filter(m=>m.categoryId===c.id).length}</strong></span>)}</div>
        <ul className="project-export-info"><li>按分类保存骨骼、图集和贴图。</li><li>附 project.json、CSV 资源清单和使用说明。</li><li>每份素材导出所选皮肤；AI 皮肤会固化为可直接使用的贴图。</li><li>游戏中使用清单内的运行时皮肤名，并匹配 Spine 运行库版本。</li></ul>
        <p className="project-hint">素材包不含游戏场景与脚本，也不合并所有 AI 皮肤为一个可切换骨骼。</p>
        {busy && exportProgress && <div className="project-export-progress" role="status"><progress value={exportProgress.completed} max={exportProgress.total}/><p>{exportProgress.phase==='packing'?'正在压缩素材包…':`正在整理 ${exportProgress.name} · ${exportProgress.completed}/${exportProgress.total}`}</p></div>}
        <div className="modal-actions"><button className="button primary" disabled={busy || !project.members.length} onClick={()=>void run(()=>onExport(project.id))}>{busy?'正在导出…':'选择位置并导出'}</button></div>
      </>}
      {error && <p className="project-error" role="alert">{error}</p>}
    </section>
  </div>;
}
