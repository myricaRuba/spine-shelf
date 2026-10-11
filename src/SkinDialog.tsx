import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Palette, Trash2, X } from "lucide-react";
import type { Asset, Library } from "./types";

export type SkinAction = { mode: "delete" | "redesign"; name: string };
export default function SkinDialog({ asset, library, action, close, notify, started, removed }: {
  asset: Asset; library: Library; action: SkinAction; close: () => void;
  notify: (message: string) => void; started: () => void; removed: (fallback: string) => void;
}) {
  // Bind confirmation to the version shown when the dialog opened.
  const [layer] = useState(() => asset.reskins?.find(s => s.name === action.name));
  const [native] = useState(() => {
    let name = action.name;
    const visited = new Set<string>();
    while (!visited.has(name)) {
      visited.add(name);
      const parent = asset.reskins?.find(s => s.name === name);
      if (!parent) return name;
      name = parent.baseSkin;
    }
    return "";
  });
  const [baseSkin, setBaseSkin] = useState(native);
  const [prompt, setPrompt] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const deleting = action.mode === "delete";
  const usedBy = library.projects.filter(p => p.members.some(m => m.assetId === asset.id && m.skin === action.name));
  const children = asset.reskins?.filter(s => s.baseSkin === action.name) || [];
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        if (typeof window.shelf.reskinCapabilities !== "function" || !(await window.shelf.reskinCapabilities()).manageSkins)
          throw new Error("皮肤管理功能已更新，请完全退出并重新打开 Spine Shelf 后使用。");
        const jobs = await window.shelf.reskinList(asset.id);
        if (!current) return;
        setPrompt(jobs.find(j => j.id === layer?.taskId)?.prompt || "");
        if (jobs.some(j => ["queued", "processing", "applying"].includes(j.status)))
          throw new Error("这个角色已有进行中的换肤任务，请先在资源信息中完成或取消。");
        if (!deleting) {
          const status = await window.shelf.reskinStatus();
          if (!status.codex.ready) throw new Error(status.codex.message);
        }
      } catch (e) { if (current) setBlocked(e instanceof Error ? e.message : String(e)); }
      finally { if (current) setChecking(false); }
    };
    void load();
    return () => { current = false; };
  }, [asset.id, layer?.taskId, deleting]);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const submit = async () => {
    if (!layer || busy || checking || blocked) return;
    setBusy(true); setError("");
    try {
      if (deleting) {
        const result = await window.shelf.reskinRemove(asset.id, action.name, layer.taskId);
        removed(result.fallbackSkin); notify(`已删除皮肤「${action.name}」`);
      } else {
        await window.shelf.reskinCreate({ assetId: asset.id, name: action.name, prompt, baseSkin,
          replaceSkin: action.name, expectedTaskId: layer.taskId });
        started(); notify(`正在重新设计「${action.name}」，成功后替换现有皮肤`);
      }
      close();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}>
    <section ref={dialog} tabIndex={-1} className="modal skin-dialog" role="dialog" aria-modal="true" aria-labelledby="skin-dialog-title" onKeyDown={e => {
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) close(); }
      if (e.key === "Tab") {
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || []);
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <button className="modal-close icon-btn" aria-label="关闭皮肤弹窗" disabled={busy} onClick={close}><X size={18} /></button>
      <span className="modal-symbol">{deleting ? <Trash2 size={23} /> : <Palette size={23} />}</span>
      <h2 id="skin-dialog-title">{deleting ? "删除皮肤" : "重新设计皮肤"}</h2>
      <p className="skin-dialog-target">{asset.name}<span>{action.name}</span></p>
      {deleting ? <>
        <p className="modal-description">删除后，皮肤列表和之后的导出将不再包含「{action.name}」。当前预览会切回「{layer?.baseSkin}」，旧贴图保留本地备份。</p>
        {usedBy.length > 0 && <p className="skin-impact">项目「{usedBy.map(p => p.name).join("、")}」中使用此皮肤的素材会切回「{layer?.baseSkin}」。</p>}
        {children.length > 0 && <p className="skin-impact">以它为基础的 {children.length} 个新增皮肤会保留现有外观。</p>}
      </> : <>
        <p className="modal-description">沿用皮肤名称和项目引用。新结果保存成功后替换，制作失败或取消时保留当前皮肤。</p>
        <label className="field"><span>绘制基础</span><select aria-label="重新设计基础" value={baseSkin} disabled={busy || checking} onChange={e => setBaseSkin(e.target.value)}>
          <option value={native}>从原版重新设计（{native}）</option><option value={action.name}>基于当前皮肤修正（{action.name}）</option>
        </select></label>
        <label className="field"><span>新的设计要求</span><textarea aria-label="新的设计要求" value={prompt} disabled={busy || checking} maxLength={4000} onChange={e => setPrompt(e.target.value)} placeholder="说明要重新设计的风格，以及上一版需要修正的部位，例如眼睛、武器或衣服。" /></label>
        <p className="reskin-help">已带入上次要求（如有），可以直接修改。制作期间请保持软件打开。</p>
      </>}
      {checking && <p className="reskin-help">正在检查皮肤状态…</p>}
      {(blocked || error || !layer) && <p className="reskin-error" role="alert">{blocked || error || "此皮肤已不存在，请重新选择。"}</p>}
      <div className="modal-actions"><button className="button" disabled={busy} onClick={close}>取消</button>
        <button className={`button ${deleting ? "danger-button" : "primary"}`} disabled={busy || checking || !!blocked || !layer || (!deleting && !prompt.trim())} onClick={() => void submit()}>
          {busy && <LoaderCircle size={15} className="spin" />}{deleting ? "确认删除皮肤" : "开始重新设计"}
        </button>
      </div>
    </section>
  </div>, document.body);
}
