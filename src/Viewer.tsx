import { useEffect, useRef, useState } from "react";
import {
  Bone,
  Camera,
  Check,
  ChevronDown,
  Expand,
  FlipHorizontal2,
  FolderOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  SkipBack,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SpineEngine } from "./engine";
import ReskinPanel from "./ReskinPanel";
import {
  type Asset,
  type Library,
  formatSize,
  CATEGORY_LABELS,
  type Category,
} from "./types";

interface Props {
  asset: Asset;
  library: Library;
  onUpdate: (id: string, patch: Partial<Asset>) => Promise<void>;
  onRemove: (asset: Asset) => void;
  notify: (message: string) => void;
  onClassify: (id: string) => Promise<void>;
  classifying: boolean;
}
export default function Viewer({
  asset,
  library,
  onUpdate,
  onRemove,
  notify,
  onClassify,
  classifying,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<SpineEngine | null>(null);
  const stage = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [animation, setAnimation] = useState(""),
    [skin, setSkin] = useState("");
  const [playing, setPlaying] = useState(true),
    [loop, setLoop] = useState(true),
    [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [zoom, setZoom] = useState(1);
  const [background, setBackground] = useState("grid"),
    [debug, setDebug] = useState(false),
    [flip, setFlip] = useState(false);
  const [tab, setTab] = useState("preview"),
    [menu, setMenu] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0),
    [metadata, setMetadata] = useState({
      animations: asset.animations,
      skins: asset.skins,
    });
  const callbacks = useRef({ onUpdate, notify });
  callbacks.current = { onUpdate, notify };

  useEffect(() => {
    if (!canvas.current) return;
    let cancelled = false,
      raf = 0,
      last = 0,
      lastUi = 0;
    const instance = new SpineEngine(canvas.current, asset);
    engine.current = instance;
    setLoading(true);
    setError("");
    setPlaying(true);
    setLoop(true);
    setSpeed(1);
    setZoom(1);
    setDebug(false);
    setFlip(false);
    instance
      .load()
      .then(async () => {
        if (cancelled) return;
        setAnimation(instance.animation);
        setSkin(instance.skin);
        setDuration(instance.duration);
        setTime(0);
        setMetadata(instance.metadata());
        setLoading(false);
        const meta = instance.metadata();
        if (
          !asset.contentFeatures?.boneNames?.length ||
          JSON.stringify(meta.animations) !==
            JSON.stringify(asset.animations) ||
          asset.bones !== meta.bones
        )
          callbacks.current.onUpdate(asset.id, { ...meta, contentRevision: asset.contentRevision || 0 }).catch(() => {});
        const animate = (now: number) => {
          if (cancelled) return;
          try {
            instance.tick(last ? (now - last) / 1000 : 0);
            last = now;
            if (now - lastUi > 90) {
              setTime(instance.time);
              setPlaying(instance.playing);
              lastUi = now;
            }
            raf = requestAnimationFrame(animate);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        };
        raf = requestAnimationFrame(animate);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      instance.dispose();
      engine.current = null;
    };
  }, [asset.id, asset.pma, asset.contentRevision, retry]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName) ||
          e.target.isContentEditable)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "Escape") setExpanded(false);
      if (e.key.toLowerCase() === "f") fit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const togglePlay = () => {
    const e = engine.current;
    if (!e?.skeleton) return;
    if (!e.loop && e.time >= e.duration) e.seek(0);
    e.playing = !e.playing;
    setPlaying(e.playing);
    setTime(e.time);
  };
  const fit = () => {
    engine.current?.skeleton && engine.current.fit();
    setZoom(1);
  };
  const changeZoom = (value: number) => {
    const next = Math.max(0.15, Math.min(6, value));
    if (engine.current) engine.current.zoom = next;
    setZoom(next);
  };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const e = engine.current;
      if (e) changeZoom(e.zoom * Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const changeAnimation = (value: string) => {
    const e = engine.current;
    if (!e?.skeleton) return;
    e.setAnimation(value);
    e.playing = true;
    setAnimation(value);
    setDuration(e.duration);
    setPlaying(true);
    setTime(0);
  };
  const capture = async () => {
    try {
      if (
        engine.current?.skeleton &&
        (await window.shelf.saveImage(asset.id, engine.current.capture()))
      )
        notify("当前帧已保存为透明 PNG");
    } catch (e) {
      notify(String(e));
    }
  };
  return (
    <aside ref={panel} className={`viewer-panel ${expanded ? "expanded" : ""}`}>
      <div className="viewer-heading">
        <span className="eyebrow">ASSET PREVIEW</span>
        <div className="inline">
          <button
            className={`icon-btn ${asset.favorite ? "is-favorite" : ""}`}
            aria-label={asset.favorite ? "取消收藏" : "收藏资源"}
            data-tooltip={
              asset.favorite ? "取消收藏此资源" : "收藏此资源，方便下次查找"
            }
            onClick={() => onUpdate(asset.id, { favorite: !asset.favorite })}
          >
            <Star size={16} fill={asset.favorite ? "currentColor" : "none"} />
          </button>
          <button
            className="icon-btn"
            aria-label={expanded ? "收起预览" : "放大预览"}
            data-tooltip={expanded ? "收起预览面板（Esc）" : "放大预览面板"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={17} /> : <Expand size={17} />}
          </button>
          <div className="menu-wrap">
            <button
              className="icon-btn"
              aria-label="资源操作"
              data-tooltip="资源操作：打开文件夹或移除资源"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={19} />
            </button>
            {menu && (
              <div className="dropdown asset-menu">
                <button
                  onClick={() => {
                    window.shelf.reveal(asset.id);
                    setMenu(false);
                  }}
                >
                  <FolderOpen size={15} />
                  在文件夹中显示
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    onRemove(asset);
                    setMenu(false);
                  }}
                >
                  <Trash2 size={15} />
                  从资源库移除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="viewer-title">
        <div>
          <h2>{asset.name}</h2>
          <span className="subtle">
            {asset.demo ? "官方演示素材" : "本地动画素材"}
            <i />
            Spine {asset.version}
          </span>
        </div>
        <span className="format-tag">{asset.format.toUpperCase()}</span>
      </div>
      <div className="detail-tabs">
        <button
          className={tab === "preview" ? "active" : ""}
          onClick={() => setTab("preview")}
        >
          动画预览
        </button>
        <button
          className={tab === "info" ? "active" : ""}
          onClick={() => setTab("info")}
        >
          资源信息
        </button>
        <span className="ready-dot">
          {loading ? "加载中" : error ? "加载失败" : "已就绪"}
        </span>
      </div>
      <div className={`preview-content ${tab !== "preview" ? "hidden" : ""}`}>
        <div
          ref={stage}
          className={`stage bg-${background}`}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).tagName !== "CANVAS") return;
            const e = engine.current;
            if (!e?.skeleton) return;
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              px: e.panX,
              py: e.panY,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const d = drag.current,
              e = engine.current;
            if (!d || !e?.skeleton) return;
            const units =
              e.renderer.camera.viewportHeight /
              event.currentTarget.clientHeight;
            e.panX = d.px - (event.clientX - d.x) * units;
            e.panY = d.py + (event.clientY - d.y) * units;
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <span className="stage-label">
            <span className={playing ? "live-dot" : ""} />
            {playing ? "LIVE PREVIEW" : "PAUSED"}
          </span>
          <canvas key={`${asset.contentRevision || 0}:${asset.pma}:${retry}`} ref={canvas} aria-label={`${asset.name} 动画画布`} />
          {loading && (
            <div className="stage-message">
              <span className="spinner" />
              正在加载动画…
            </div>
          )}
          {error && (
            <div className="stage-message error">
              <Bone size={28} />
              <b>这份素材暂时无法预览</b>
              <p>{error}</p>
              <button className="button" onClick={() => setRetry(retry + 1)}>
                重新加载
              </button>
            </div>
          )}
          <div className="stage-toolbar">
            <button
              className={`icon-btn ${debug ? "active" : ""}`}
              data-tooltip={debug ? "隐藏骨骼结构" : "显示骨骼：查看骨骼结构"}
              aria-label="显示骨骼"
              onClick={() => {
                if (engine.current) engine.current.debug = !debug;
                setDebug(!debug);
              }}
            >
              <Bone size={16} />
            </button>
            <button
              className={`icon-btn ${flip ? "active" : ""}`}
              data-tooltip={flip ? "取消水平翻转" : "水平翻转：左右镜像预览"}
              aria-label="水平翻转"
              onClick={() => {
                if (engine.current) engine.current.flip = !flip;
                setFlip(!flip);
              }}
            >
              <FlipHorizontal2 size={16} />
            </button>
            <span className="divider" />
            <button
              className="icon-btn"
              data-tooltip="截图：将当前帧保存为透明 PNG"
              aria-label="保存截图"
              onClick={capture}
            >
              <Camera size={16} />
            </button>
          </div>
          <div className="stage-bottom">
            <div className="swatches">
              {["grid", "dark", "light", "green"].map((bg) => (
                <button
                  key={bg}
                  className={`swatch ${bg} ${background === bg ? "selected" : ""}`}
                  aria-label={`背景 ${bg}`}
                  data-tooltip={
                    {
                      grid: "网格背景",
                      dark: "深色背景",
                      light: "浅色背景",
                      green: "绿色背景",
                    }[bg]
                  }
                  onClick={() => setBackground(bg)}
                />
              ))}
            </div>
            <div className="zoom-tools">
              <button
                className="icon-btn"
                aria-label="缩小"
                data-tooltip="缩小动画预览（也可滚轮缩放）"
                onClick={() => changeZoom(zoom / 1.2)}
              >
                <ZoomOut size={14} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="icon-btn"
                aria-label="放大"
                data-tooltip="放大动画预览（也可滚轮缩放）"
                onClick={() => changeZoom(zoom * 1.2)}
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="icon-btn"
                aria-label="适应画布"
                data-tooltip="适应画布：居中并重置缩放（F）"
                onClick={fit}
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
        </div>
        <div className="transport">
          <div className="timeline">
            <span>{time.toFixed(2)}s</span>
            <input
              aria-label="播放进度"
              type="range"
              min="0"
              max={duration || 1}
              step="0.001"
              value={time}
              style={
                {
                  "--progress": `${duration ? (time / duration) * 100 : 0}%`,
                } as React.CSSProperties
              }
              onChange={(event) => {
                const e = engine.current;
                if (e?.skeleton) {
                  e.playing = false;
                  e.seek(Number(event.target.value));
                  setTime(e.time);
                  setPlaying(false);
                }
              }}
            />
            <span>{duration.toFixed(2)}s</span>
          </div>
          <div className="playback-buttons">
            <button
              className={`icon-btn ${loop ? "active" : ""}`}
              aria-label="循环播放"
              data-tooltip={loop ? "关闭循环：播放一遍后停止" : "开启循环播放"}
              aria-pressed={loop}
              onClick={() => {
                engine.current?.skeleton && engine.current.setLoop(!loop);
                setLoop(!loop);
              }}
            >
              <Repeat2 size={18} />
            </button>
            <div className="inline">
              <button
                className="icon-btn"
                aria-label="回到开头"
                data-tooltip="将播放进度回到第一帧"
                onClick={() => {
                  engine.current?.skeleton && engine.current.seek(0);
                  setTime(0);
                }}
              >
                <SkipBack size={17} />
              </button>
              <button
                className="play-btn"
                aria-label={playing ? "暂停" : "播放"}
                data-tooltip={playing ? "暂停播放（空格）" : "继续播放（空格）"}
                onClick={togglePlay}
                disabled={loading || !!error}
              >
                {playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button
                className="icon-btn"
                aria-label="重播"
                data-tooltip="从头开始播放动画"
                onClick={() => {
                  const e = engine.current;
                  if (e?.skeleton) {
                    e.seek(0);
                    e.playing = true;
                    setPlaying(true);
                  }
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <select
              className="speed-select"
              aria-label="播放速度"
              data-tooltip="调整动画播放速度"
              value={speed}
              onChange={(event) => {
                const v = Number(event.target.value);
                if (engine.current) engine.current.speed = v;
                setSpeed(v);
              }}
            >
              {[0.25, 0.5, 1, 1.5, 2, 3].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="animation-settings">
          <label>
            <span>
              <Play size={13} />
              动画 <small>{metadata.animations.length}</small>
            </span>
            <div className="select-wrap">
              <select
                aria-label="动画"
                value={animation}
                disabled={loading || !!error}
                onChange={(e) => changeAnimation(e.target.value)}
              >
                {metadata.animations.length ? (
                  metadata.animations.map((a) => <option key={a}>{a}</option>)
                ) : (
                  <option>无动画</option>
                )}
              </select>
              <ChevronDown size={14} />
            </div>
          </label>
          <label>
            <span>
              <Bone size={13} />
              皮肤 <small>{metadata.skins.length}</small>
            </span>
            <div className="select-wrap">
              <select
                aria-label="皮肤"
                value={skin}
                disabled={loading || !!error}
                onChange={(event) => {
                  engine.current?.setSkin(event.target.value);
                  setSkin(event.target.value);
                  setZoom(1);
                }}
              >
                {metadata.skins.length ? (
                  metadata.skins.map((s) => <option key={s}>{s}</option>)
                ) : (
                  <option>默认</option>
                )}
              </select>
              <ChevronDown size={14} />
            </div>
          </label>
        </div>
        <div className="viewer-hint">
          滚轮缩放<span>·</span>拖动画布平移<span>·</span>
          <kbd>空格</kbd> 播放 / 暂停
        </div>
      </div>
      {tab === "info" && (
        <div className="info-panel">
          <ReskinPanel key={asset.id} asset={asset} skin={skin} notify={notify} showSkin={(name) => {
            const instance = engine.current;
            if (!instance?.skeleton || !instance.data.findSkin(name)) { notify("皮肤正在加载，请稍后再试"); return; }
            instance.setSkin(name); setSkin(name); setTab("preview");
          }} />
          <label className="field">
            <span>资源名称</span>
            <input
              key={asset.id + "name"}
              aria-label="资源名称"
              defaultValue={asset.name}
              onBlur={(e) => {
                if (e.target.value.trim() !== asset.name)
                  onUpdate(asset.id, { name: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>
              内容分类{" "}
              <small>
                {asset.categorySource === "manual" ? "手动设置" : "自动识别"}
              </small>
            </span>
            <select
              aria-label="内容分类"
              value={asset.category || "unclassified"}
              onChange={(e) =>
                onUpdate(asset.id, { category: e.target.value as Category })
              }
            >
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                  {category === "material" ? "（框、文字等）" : ""}
                </option>
              ))}
            </select>
            <p className="classification-reason">
              {asset.categoryReasons?.join("；")}
            </p>
            {asset.categorySource === "manual" && (
              <button
                className="text-button restore-classification"
                disabled={classifying}
                onClick={() => onClassify(asset.id)}
              >
                恢复自动分类
              </button>
            )}
          </label>
          <label className="field">
            <span>所属分组</span>
            <select
              aria-label="所属分组"
              value={asset.collectionId || ""}
              onChange={(e) =>
                onUpdate(asset.id, { collectionId: e.target.value || null })
              }
            >
              <option value="">未分组</option>
              {library.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              标签 <small>用逗号分隔</small>
            </span>
            <input
              key={asset.id + "tags"}
              aria-label="资源标签"
              placeholder="角色，战斗，项目名称…"
              defaultValue={asset.tags.join("，")}
              onBlur={(e) =>
                onUpdate(asset.id, { tags: e.target.value.split(/[,，]/) })
              }
            />
          </label>
          <label className="field">
            <span>备注</span>
            <textarea
              key={asset.id + "note"}
              aria-label="资源备注"
              placeholder="记下这份动画的使用方式…"
              defaultValue={asset.note}
              onBlur={(e) => onUpdate(asset.id, { note: e.target.value })}
            />
          </label>
          <dl className="asset-facts">
            <div>
              <dt>Spine 版本</dt>
              <dd>{asset.version}</dd>
            </div>
            <div>
              <dt>资源大小</dt>
              <dd>{formatSize(asset.size)}</dd>
            </div>
            <div>
              <dt>骨骼 / 插槽</dt>
              <dd>
                {asset.bones} / {asset.slots}
              </dd>
            </div>
            <div>
              <dt>贴图页数</dt>
              <dd>{asset.pages}</dd>
            </div>
            <div>
              <dt>导入时间</dt>
              <dd>{new Date(asset.importedAt).toLocaleDateString("zh-CN")}</dd>
            </div>
          </dl>
          {asset.runtime !== "4.3" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={asset.pma}
                onChange={(e) => onUpdate(asset.id, { pma: e.target.checked })}
              />
              预乘透明度（PMA）
            </label>
          )}
          <button
            className="button full-width"
            onClick={() => window.shelf.reveal(asset.id)}
          >
            <FolderOpen size={16} />
            打开资源文件夹
          </button>
          <button
            className="text-button danger"
            onClick={() => onRemove(asset)}
          >
            <Trash2 size={14} />
            从资源库移除
          </button>
        </div>
      )}
      <div className="viewer-footer">
        <span>
          <Check size={12} />
          已保存到本地资源库
        </span>
        <span>{formatSize(asset.size)}</span>
      </div>
      {expanded && (
        <button
          className="close-expanded icon-btn"
          aria-label="关闭大预览"
          onClick={() => setExpanded(false)}
        >
          <X size={20} />
        </button>
      )}
    </aside>
  );
}
