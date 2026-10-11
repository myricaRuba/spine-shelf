import { useEffect, useState } from "react";
import { Check, LoaderCircle, Palette, Play, X, Trash2 } from "lucide-react";
import { type Asset, type ReskinJob } from "./types";
import ReskinProgress from "./ReskinProgress";

const labels: Record<ReskinJob["status"], string> = {
  queued: "等待开始", processing: "制作中", applying: "正在添加", completed: "已添加",
  failed: "需要处理", cancelled: "已取消",
};
export default function ReskinPanel({ asset, skin, notify, showSkin, manageSkin }: {
  asset: Asset; skin: string; notify: (message: string) => void; showSkin: (name: string) => void;
  manageSkin: (name:string, mode:"delete"|"redesign") => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [baseSkin, setBaseSkin] = useState(skin || asset.skins[0] || "default");
  const [jobs, setJobs] = useState<ReskinJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codex, setCodex] = useState({ready:false,message:"正在检查 Codex…"});
  useEffect(() => {
    if (!asset.skins.includes(baseSkin)) setBaseSkin(asset.skins.includes(skin) ? skin : asset.skins[0] || "default");
  }, [asset.skins, baseSkin, skin]);
  useEffect(() => {
    let current = true, revision = 0, checking = false;
    const refreshJobs = async () => {
      const request = ++revision;
      try {
        const next = await window.shelf.reskinList(asset.id);
        if (current && revision === request) setJobs(next);
      } catch (e) { if (current) setError(String(e)); }
    };
    const refreshStatus = async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await window.shelf.reskinStatus();
        if (current) setCodex(status.codex);
      } catch (e) { if (current) setCodex({ready:false,message:String(e)}); }
      finally {checking = false;}
    };
    void refreshJobs(); void refreshStatus();
    const unsubscribe = window.shelf.onReskinChange(() => void refreshJobs());
    const timer = setInterval(() => { void refreshJobs(); void refreshStatus(); }, 5000);
    return () => { current = false; unsubscribe(); clearInterval(timer); };
  }, [asset.id]);
  const active = jobs.find(j => ["queued", "processing", "applying"].includes(j.status));
  const create = async () => {
    setBusy(true); setError("");
    try {
      await window.shelf.reskinCreate({ assetId: asset.id, name, prompt, baseSkin });
      setJobs(await window.shelf.reskinList(asset.id));
      setName(""); setPrompt(""); notify("已交给 Codex，正在制作");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setJobs(await window.shelf.reskinList(asset.id).catch(() => jobs)); }
    finally { setBusy(false); }
  };
  const run = async (id: string, cancel = false) => {
    setBusy(true);setError("");
    try { if(cancel)await window.shelf.reskinCancel(id);else await window.shelf.reskinStart(id); setJobs(await window.shelf.reskinList(asset.id)); }
    catch (e) { setError(String(e)); }
    finally {setBusy(false);}
  };
  return <section className="reskin-panel" aria-label="AI 换肤">
    <div className="reskin-heading"><span><Palette size={16} />AI 换肤</span><small>{codex.ready ? "Codex 已就绪" : "Codex 未就绪"}</small></div>
    <p className="reskin-intro">为当前角色添加新皮肤，保留原来的动画。</p>
    {!!asset.reskins?.length && <div className="skin-management" aria-label="新增皮肤管理">
      <h3>已有的新增皮肤</h3>
      {asset.reskins.map(s => <div className="skin-management-row" key={s.name}>
        <button className="text-button skin-name" onClick={() => showSkin(s.name)} title={`预览 ${s.name}`}>{s.name}</button>
        <button className="text-button" aria-label={`重新设计 ${s.name}`} disabled={busy || !!active} onClick={() => manageSkin(s.name,"redesign")}><Palette size={13} />重新设计</button>
        <button className="text-button danger" aria-label={`删除皮肤 ${s.name}`} disabled={busy || !!active} onClick={() => manageSkin(s.name,"delete")}><Trash2 size={13} />删除</button>
      </div>)}
    </div>}
    {!codex.ready && <p className="reskin-help">{codex.message}</p>}
    {!active && <div className="reskin-form">
      <label className="field"><span>基础皮肤</span><select aria-label="换肤基础皮肤" value={baseSkin} onChange={e => setBaseSkin(e.target.value)}>
        {asset.skins.map(s => <option key={s} value={s}>{s === "default" ? "default（原版）" : s}</option>)}
      </select></label>
      <label className="field"><span>新皮肤名称</span><input aria-label="新皮肤名称" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="例如：紫发机甲" /></label>
      <label className="field"><span>换肤要求</span><textarea aria-label="换肤要求" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} placeholder="例如：头发换成紫色，衣服和弓箭改成未来机甲风" /></label>
      <button className="button primary full-width" disabled={busy || !codex.ready || !name.trim() || !prompt.trim()} onClick={() => void create()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}开始制作
      </button>
      <p className="reskin-help">使用已登录的 Codex 制作，完成后自动加入皮肤列表。制作期间请保持软件打开。</p>
    </div>}
    {error && <p className="reskin-error" role="alert">{error}</p>}
    {jobs.slice(0, 5).map(job => <div className={`reskin-job ${job.status}`} key={job.id}>
      <div className="reskin-job-heading"><strong>{job.name}{job.replaceSkin && <small> · 重新设计</small>}</strong><span>{job.status === 'completed' && job.replaceSkin ? '已替换' : labels[job.status]}</span></div>
      <p className="reskin-current-message">{job.message}</p>
      <ReskinProgress job={job}/>
      {job.status === "queued" && <p className="reskin-help">点击开始，Codex 会在后台处理。</p>}
      <div className="reskin-actions">
        {job.status === "queued" && <button className="text-button" disabled={busy || !codex.ready} onClick={() => void run(job.id)}><Play size={13} />开始制作</button>}
        {["queued", "processing"].includes(job.status) && <button className="text-button" disabled={busy} onClick={() => void run(job.id,true)}><X size={13} />取消</button>}
        {job.status === "failed" && !active && <button className="text-button" disabled={busy || !codex.ready} onClick={() => void run(job.id)}>重新制作</button>}
        {job.status === "completed" && (asset.reskins?.some(s => s.taskId === job.id)
          ? <button className="text-button" onClick={() => showSkin(job.name)}><Check size={13} />查看皮肤</button>
          : <span className="reskin-help">此版本已删除或已被重新设计替换</span>)}
      </div>
    </div>)}
  </section>;
}
