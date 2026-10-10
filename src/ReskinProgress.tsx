import { useEffect, useRef, useState } from "react";
import { Check, Circle, Clock3, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReskinDetails, ReskinJob } from "./types";

function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
const clock = (value?: string) => value ? new Date(value).toLocaleTimeString("zh-CN", {hour12:false}) : "此前";
export default function ReskinProgress({ job }: {job: ReskinJob}) {
  const [details, setDetails] = useState<ReskinDetails>();
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [now, setNow] = useState(Date.now());
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const active = ["processing", "applying"].includes(job.status);
  useEffect(() => {
    let current = true, reading = false, again = false;
    const refresh = async () => {
      if (reading) {again = true; return;}
      reading = true;
      try {
        const next = await window.shelf.reskinDetails(job.id);
        if (current) {setDetails(next);setError("");}
      } catch(e) {if (current) setError(String(e));}
      finally {
        reading = false;
        if (current && again) {again = false;void refresh();}
      }
    };
    void refresh();
    const off = window.shelf.onReskinChange(() => void refresh());
    const timer = setInterval(() => {setNow(Date.now());if (active) void refresh();},2000);
    return () => {current = false;off();clearInterval(timer);};
  },[job.id,active]);
  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  },[details,all]);
  const entries = details?.entries || [];
  const lastAt = entries.reduce((latest,e) => Math.max(latest, Date.parse(e.updatedAt || e.at || "") || 0),Date.parse(job.updatedAt));
  const start = Date.parse(job.execution?.startedAt || job.createdAt);
  const end = active ? now : Date.parse(job.updatedAt);
  const pending = active && details?.running ? entries.filter(e=>e.status === "running").at(-1) : undefined;
  const shown = all ? entries : entries.filter(e=>e.kind !== "tool" || e.status === "failed");
  return <div className="reskin-progress">
    <div className="reskin-timing">
      <span><Clock3 size={12}/>{job.execution ? `${active ? "已用" : "本次用时"} ${duration(end-start)}` : "尚未开始"}</span>
      {active && <span>最近记录 {duration(now-lastAt)}前</span>}
    </div>
    {pending && <div className="reskin-operation"><LoaderCircle size={12} className="spin"/>{pending.text}</div>}
    {active && now-lastAt > 60000 && <p className="reskin-help">{details?.running ? "暂时没有新消息，任务仍在后台运行。" : "等待后台状态更新…"}</p>}
    <details className="reskin-details" onToggle={event=> {
      if (event.currentTarget.open && follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    }}>
      <summary>制作详情 <span>{entries.length ? `${entries.length} 条记录` : ""}</span></summary>
      <dl className="reskin-request"><dt>基础皮肤</dt><dd>{job.baseSkin}</dd><dt>换肤要求</dt><dd>{job.prompt}</dd><dt>本次开始</dt><dd>{job.execution?.startedAt ? new Date(job.execution.startedAt).toLocaleString("zh-CN",{hour12:false}) : "等待开始"}</dd></dl>
      <div className="reskin-log-tabs" role="group" aria-label="制作记录筛选">
        <button aria-pressed={!all} onClick={()=>setAll(false)}>主要进度</button>
        <button aria-pressed={all} onClick={()=>setAll(true)}>全部操作</button>
      </div>
      {error && <p className="reskin-error" role="alert">详情读取失败：{error}</p>}
      <div className="reskin-log" ref={feed} tabIndex={0} aria-label="制作记录" onScroll={()=> {
        const el = feed.current;if (el) follow.current = el.scrollHeight-el.clientHeight-el.scrollTop < 36;
      }}>
        {!!details?.trimmed && <p className="reskin-help">显示最近 {entries.length} 条记录，更早的 {details.trimmed} 条已省略。</p>}
        {entries.some(e=>e.legacy) && <p className="reskin-help">旧版本记录未保存时间，按原顺序显示。</p>}
        {!shown.length && <p className="reskin-help">{details ? "尚无处理记录，开始后将在这里更新。" : "正在读取记录…"}</p>}
        <ol>{shown.map(entry => <li className={`reskin-log-entry ${entry.status}`} key={entry.id}>
          <div className="reskin-log-meta"><time dateTime={entry.at}>{clock(entry.at)}</time>
            {entry.status === "running" ? <><LoaderCircle size={12} className="spin"/>进行中</> : entry.status === "failed" ? <><TriangleAlert size={12}/>{entry.kind === "tool" ? "操作未成功" : "错误"}</> : entry.status === "completed" ? <><Check size={12}/>已完成</> : <><Circle size={8}/>{entry.kind === "message" ? "Codex" : "进度"}</>}
            {entry.kind === "tool" && entry.at && entry.updatedAt && entry.status !== "running" && <span>{duration(Date.parse(entry.updatedAt)-Date.parse(entry.at))}</span>}
          </div>
          <p>{entry.text}</p>
          {entry.detail && <p>{entry.detail}</p>}
          {entry.exitCode !== undefined && entry.exitCode !== 0 && <small>退出码 {entry.exitCode}</small>}
        </li>)}</ol>
      </div>
    </details>
  </div>;
}
