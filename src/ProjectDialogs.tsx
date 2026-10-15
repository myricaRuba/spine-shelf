import {useEffect,useMemo,useState} from "react";
import {FolderPlus,Plus,Trash2,Upload,X} from "lucide-react";
import {assetUrl,CATEGORY_LABELS,type Library,type ProjectAction,type ProjectInput,type ProjectExportProgress,type ProjectExportOptions,type ProjectExportPlan,type SpineExportTarget} from "./types";

export type ProjectDialogState = {mode:"create"|"settings"|"picker"|"assign"|"member"|"export";projectId?:string;assetIds?:string[]};
export default function ProjectDialogs({state,library,close,mutate,onCreated,onExport,exportProgress,onImport}: {
  state:ProjectDialogState;library:Library;close:()=>void;
  mutate:(action:ProjectAction,input:ProjectInput)=>Promise<string>;
  onCreated:(id:string)=>void;onExport:(id:string,options:ProjectExportOptions)=>Promise<boolean>;
  exportProgress:ProjectExportProgress|null;
  onImport:(projectId:string)=>void;
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
  const [exportTarget,setExportTarget]=useState<SpineExportTarget>('original');
  const [exportSkinMode,setExportSkinMode]=useState<'switchable'|'current'>('switchable');
  const [exportScope,setExportScope]=useState<'all'|'selected'>('all');
  const [exportIds,setExportIds]=useState<string[]>([]);
  const [exportSearch,setExportSearch]=useState('');
  const exportMembers=useMemo(()=>project?.members.filter(m=>exportScope==='all' || exportIds.includes(m.assetId)) || [],[project,exportScope,exportIds]);
  const exportOptions=useMemo<ProjectExportOptions>(()=>({targetVersion:exportTarget,skinMode:exportSkinMode,...(exportScope==='selected'?{assetIds:exportMembers.map(m=>m.assetId)}:{})}),[exportTarget,exportSkinMode,exportScope,exportMembers]);
  const [exportPlan,setExportPlan]=useState<ProjectExportPlan|null>(null);
  const [checking,setChecking]=useState(false);
  const [planRevision,setPlanRevision]=useState(0);
  useEffect(()=>{
    if(state.mode!=='export' || !project)return;
    let active=true;setChecking(true);setExportPlan(null);setError('');
    if(typeof window.shelf.projectExportPlan!=='function') {setError('导出功能已更新，请重新打开 Spine Shelf 后使用。');setChecking(false);return;}
    window.shelf.projectExportPlan(project.id,exportOptions).then(plan=>{
      if(plan.skinMode!==exportOptions.skinMode)throw new Error('皮肤导出功能已更新，请完全退出并重新打开 Spine Shelf 后使用。');
      if(active)setExportPlan(plan);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[state.mode,project,exportOptions,planRevision]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape' && !busy)close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,close]);
  const run=async(action:()=>Promise<unknown>,finish=true)=>{
    setBusy(true);setError("");try{await action();if(finish)close();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const title=({create:'新建项目',settings:'项目设置',picker:'从资源库添加',assign:'加入项目',member:'项目中的素材',export:'导出项目'})[state.mode];
  const chooseCategory=(categories=targetProject?.categories || [])=><label className="field"><span>项目分类</span><select aria-label="项目分类" value={category} onChange={e=>setCategory(e.target.value)}>
    {state.mode!=='member' && <option value="">按资源分类自动分配</option>}{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
  </select></label>;
  const available=library.assets.filter(a=>[a.name,...a.tags].join(' ').toLowerCase().includes(search.toLowerCase()));
  const assetsById=new Map(library.assets.map(a=>[a.id,a]));
  const exportRows=(project?.members || []).filter(m=>exportScope==='all' || [m.label,assetsById.get(m.assetId)?.name,project?.categories.find(c=>c.id===m.categoryId)?.name].join(' ').toLowerCase().includes(exportSearch.trim().toLowerCase()));
  const plansById=new Map(exportPlan?.assets.map(a=>[a.id,a]));
  const selectExportIds=(ids:string[])=>{setExportPlan(null);setExportIds(ids);};
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
        <button className="text-button project-import-link" disabled={busy} onClick={()=>onImport(project.id)}><Upload size={14}/>从本地导入新资源</button>
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
        <label className="field"><span>默认显示皮肤</span><select aria-label="项目导出皮肤" value={skin} onChange={e=>setSkin(e.target.value)}>{asset.skins.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <p className="project-hint">导出可切换皮肤时会包含全部外观；选择「仅当前皮肤」时只打包此处所选外观的贴图。</p>
        <label className="field"><span>用途备注</span><textarea aria-label="项目素材备注" value={memberNote} onChange={e=>setMemberNote(e.target.value)} maxLength={2000} placeholder="例如：玩家角色、第一关地形"/></label>
        <div className="modal-actions"><button className="button primary" disabled={busy} onClick={()=>void run(()=>mutate('member',{projectId:project.id,assetId:asset.id,categoryId:category,skin,label,note:memberNote}))}>保存素材设置</button></div>
      </>}
      {state.mode==='export' && project && <>
        <p className="modal-description">将「{project.name}」导出为 ZIP 通用素材包。</p>
        <fieldset className="project-export-scope" disabled={busy}><legend>导出范围</legend>
          <label className={exportScope==='all'?'active':''}><input type="radio" name="export-scope" value="all" checked={exportScope==='all'} onChange={()=>{setExportPlan(null);setExportScope('all');}}/>全部导出 <small>{project.members.length} 份素材</small></label>
          <label className={exportScope==='selected'?'active':''}><input type="radio" name="export-scope" value="selected" checked={exportScope==='selected'} onChange={()=>{setExportPlan(null);setExportScope('selected');}}/>按需导出 <small>自己选择素材</small></label>
        </fieldset>
        <p className="project-export-summary" role="status">本次导出 {exportMembers.length} / {project.members.length} 份素材</p>
        <div className="project-export-counts">{project.categories.filter(c=>exportMembers.some(m=>m.categoryId===c.id)).map(c=><span key={c.id}>{c.name}<strong>{exportMembers.filter(m=>m.categoryId===c.id).length}</strong></span>)}</div>
        <label className="field"><span>目标 Spine 版本</span><select aria-label="目标 Spine 版本" value={exportTarget} disabled={busy} onChange={e=>{setExportPlan(null);setExportTarget(e.target.value as SpineExportTarget);}}>
          <option value="original">保留各素材原版本</option>
          <option value="3.6">Spine 3.6</option>
          <option value="3.8">Spine 3.8 · Cocos 3.8 运行库</option>
          <option value="4.0">Spine 4.0</option><option value="4.1">Spine 4.1</option>
          <option value="4.2">Spine 4.2 · Cocos 4.2 运行库</option><option value="4.3">Spine 4.3</option>
        </select></label>
        <p className="project-hint">同版本保留版本号；版本转换或合并新增皮肤使用 JSON 骨骼。Spine 3.8.75 选择 3.8 时会重新导出为 3.8.99。暂不自动降级。</p>
        <label className="field"><span>皮肤导出方式</span><select aria-label="皮肤导出方式" value={exportSkinMode} disabled={busy} onChange={e=>{setExportPlan(null);setExportSkinMode(e.target.value as 'switchable'|'current');}}>
          <option value="switchable">可切换皮肤（原版 + 全部新增皮肤）</option><option value="current">仅当前皮肤（单套贴图）</option>
        </select></label>
        <p className="project-hint">{exportSkinMode==='switchable'?'把全部皮肤和贴图合并到同一份 Spine，在 Cocos 的皮肤下拉框或代码中切换。SKEL 含新增皮肤时需本机 Spine 转为 JSON。':'只导出项目所选外观的贴图；游戏中使用清单里的 runtimeSkin 名称。'}</p>
        {checking && <p className="project-hint" role="status">正在检查素材版本…</p>}
        {exportScope==='selected' && <div className="project-export-selection">
          <input className="project-picker-search" aria-label="搜索导出素材" placeholder="搜索素材名称或分类" value={exportSearch} disabled={busy} onChange={e=>setExportSearch(e.target.value)}/>
          <div className="project-picker-summary"><button className="text-button" disabled={busy || !exportRows.length} onClick={()=>selectExportIds([...new Set([...exportIds,...exportRows.map(m=>m.assetId)])])}>{exportSearch.trim()?'全选搜索结果':'全选'}</button><button className="text-button" disabled={busy || !exportMembers.length} onClick={()=>selectExportIds([])}>清空选择</button><span>已选 {exportMembers.length} 份</span></div>
        </div>}
        <div className="project-export-versions"><table aria-label="素材版本检查"><thead><tr>{exportScope==='selected' && <th className="export-checkbox-cell">选择</th>}<th>素材</th><th>当前版本</th><th>导出处理</th></tr></thead><tbody>{exportRows.map(m=>{
          const a=assetsById.get(m.assetId),plan=plansById.get(m.assetId),selected=exportScope==='all' || exportIds.includes(m.assetId),name=m.label || a?.name || m.assetId;
          return <tr key={m.assetId} className={selected?(plan?.action==='blocked'?'export-blocked':''):'export-unselected'}>
            {exportScope==='selected' && <td className="export-checkbox-cell"><input id={`export-asset-${m.assetId}`} type="checkbox" aria-label={`导出 ${name}`} checked={selected} disabled={busy} onChange={e=>selectExportIds(e.target.checked?[...exportIds,m.assetId]:exportIds.filter(id=>id!==m.assetId))}/></td>}
            <td><label className="export-asset-name" htmlFor={exportScope==='selected'?`export-asset-${m.assetId}`:undefined}>{a?.thumbnail && <img src={assetUrl(a,'thumbnail.png')} alt=""/>}<span>{name}<small>{project.categories.find(c=>c.id===m.categoryId)?.name} · {m.skin}</small></span></label></td>
            <td className="export-version-cell">{plan?.version || a?.version || '未知'}</td><td>{selected?(checking?'检查中…':plan?.message || '—'):'未选中'}{selected && !checking && plan && <small className="export-skin-list">{exportSkinMode==='switchable'?'可切换':'外观'}：{plan.skins.join(' / ')}</small>}</td>
          </tr>;
        })}{!exportRows.length && <tr><td colSpan={exportScope==='selected'?4:3}>没有找到匹配的素材。</td></tr>}</tbody></table></div>
        {exportScope==='selected' && !exportMembers.length && <p className="project-hint">请勾选至少一份需要导出的素材。</p>}
        {exportTarget!=='original' && <div className="project-export-converter">
          <div><strong>本机 Spine 编辑器</strong><p>{exportPlan?.converter.message || '检查连接中…'}</p>{exportPlan?.converter.path && <small title={exportPlan.converter.path}>{exportPlan.converter.path}</small>}</div>
          <button className="button" disabled={busy || checking} onClick={()=>void run(async()=>{const status=await window.shelf.projectSelectSpine();if(status)setPlanRevision(n=>n+1);},false)}>{exportPlan?.converter.available?'更换 Spine':'选择 Spine 程序'}</button>
          <p className="project-hint">转换需本机 Spine 能正常导出，并可使用对应的源版本与目标版本。原素材和已完成的导出包不会被失败转换覆盖。</p>
        </div>}
        <ul className="project-export-info"><li>按分类保存骨骼、图集和贴图。</li><li>附 project.json、CSV 资源清单和使用说明。</li><li>{exportSkinMode==='switchable'?'皮肤写入骨骼数据，原皮肤和新增皮肤可以在游戏中切换。':'当前外观固化到导出贴图中。'}</li><li>游戏中匹配 Spine 运行库版本。</li></ul>
        <p className="project-hint">素材包不含游戏场景与脚本。</p>
        {error && <p className="project-error" role="alert">{error}</p>}
        {busy && exportProgress && <div className="project-export-progress" role="status"><progress value={exportProgress.completed} max={exportProgress.total}/><p>{exportProgress.phase==='packing'?'正在压缩素材包…':exportProgress.phase==='converting'?`正在转换 ${exportProgress.name} → Spine ${exportTarget}…`:`正在整理 ${exportProgress.name} · ${exportProgress.completed}/${exportProgress.total}`}</p></div>}
        <div className="modal-actions"><span className="project-export-total">将导出 {exportMembers.length} 份素材</span><button className="button primary" disabled={busy || checking || !exportMembers.length || !exportPlan?.canExport} onClick={()=>void run(async()=>{if(await onExport(project.id,exportOptions))close();},false)}>{busy?'正在处理…':'选择位置并导出'}</button></div>
      </>}
      {error && state.mode!=='export' && <p className="project-error" role="alert">{error}</p>}
    </section>
  </div>;
}
