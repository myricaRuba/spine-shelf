import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { version as appVersion } from "../package.json";
import {
  ArrowDownUp,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileBox,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  HelpCircle,
  Image,
  LayoutGrid,
  LibraryBig,
  List,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Upload,
  UserRound,
  Mountain,
  Shapes,
  CircleHelp,
  Download,
  X,
} from "lucide-react";
import Viewer from "./Viewer";
import PreviewPane from "./PreviewPane";
import Tooltips from "./Tooltips";
import GenerationDialog from './GenerationDialog';
import ProjectDialogs, {type ProjectDialogState} from "./ProjectDialogs";
import { SpineEngine } from "./engine";
import {
  type Asset,
  type ImportReport,
  type Library,
  assetUrl,
  formatSize,
  CATEGORY_LABELS,
  type Category,
  type ProjectAction, type ProjectInput, type ProjectExportProgress, type ProjectExportOptions,
} from "./types";

type Modal =
  | "import"
  | "collection"
  | "settings"
  | "help"
  | "remove"
  | "removeCollection"
  | null;
const emptyLibrary: Library = {
  version: 1,
  assets: [],
  collections: [],
  projects: [],
  root: "",
};
const categoryIcons = {
  character: UserRound,
  scene: Mountain,
  material: Shapes,
  unclassified: CircleHelp,
};
const isMac = window.shelf?.platform === "darwin";
const shortcutKey = isMac ? "⌘" : "Ctrl";

export default function App() {
  const [library, setLibrary] = useState<Library>(emptyLibrary),
    [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(""),
    [section, setSection] = useState("all");
  const [search, setSearch] = useState(""),
    [format, setFormat] = useState("all"),
    [sort, setSort] = useState("recent"),
    [view, setView] = useState("grid");
  const [modal, setModal] = useState<Modal>(null),
    [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false),
    [toast, setToast] = useState(""),
    [dragging, setDragging] = useState(false);
  const [collectionName, setCollectionName] = useState(""),
    [removeTarget, setRemoveTarget] = useState<Asset | null>(null);
  const [bootError, setBootError] = useState("");
  const [generationOpen,setGenerating]=useState(false);
  const [classifying, setClassifying] = useState(false);
  const [projectDialog,setProjectDialog]=useState<ProjectDialogState|null>(null);
  const [projectCategory,setProjectCategory]=useState('all');
  const [batch,setBatch]=useState(false),[checkedAssets,setCheckedAssets]=useState<string[]>([]);
  const [exporting,setExporting]=useState(false),[exportProgress,setExportProgress]=useState<ProjectExportProgress|null>(null);
  const searchRef = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const generating = useRef(false),
    thumbAttempts = useRef(new Set<string>()),
    dragCounter = useRef(0);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const applyLibrary = useCallback((data: Library) => {
    libraryRef.current = data;
    setLibrary(data);
  }, []);
  useEffect(() => window.shelf?.onLibraryChange(applyLibrary), [applyLibrary]);
  useEffect(()=>window.shelf?.onProjectExportProgress(setExportProgress),[]);
  useEffect(() => {
    if (!window.shelf) {
      setBootError(
        "请使用桌面应用打开 Spine Shelf，以便导入并保存本地素材。运行 npm run dev 即可启动。",
      );
      setLoaded(true);
      return;
    }
    window.shelf
      .getLibrary()
      .then((data) => {
        applyLibrary(data);
        setSelectedId(data.assets[0]?.id || "");
        setLoaded(true);
      })
      .catch((e) => {
        setBootError(String(e));
        setLoaded(true);
      });
  }, [applyLibrary]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setReport(null);
        setModal("import");
      }
      if (event.key === "Escape" && !importing) {
        setModal(null);
        setGenerating(false);
        setDragging(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [importing]);
  const thumbnailRevision = library.assets.map(a => `${a.id}:${a.contentRevision || 0}`).join(",");
  useEffect(() => {
    if (!loaded || generating.current || !window.shelf) return;
    generating.current = true;
    // Generate static thumbnails one at a time: the library never creates one WebGL context per card.
    const run = async () => {
      while (true) {
        const asset = libraryRef.current.assets.find(
          (a) => !a.thumbnail && !thumbAttempts.current.has(`${a.id}:${a.contentRevision || 0}`),
        );
        if (!asset) break;
        thumbAttempts.current.add(`${asset.id}:${asset.contentRevision || 0}`);
        const canvas = document.createElement("canvas");
        canvas.width = 520;
        canvas.height = 380;
        const renderer = new SpineEngine(canvas, asset);
        try {
          await renderer.load();
          if (!libraryRef.current.assets.some((a) => a.id === asset.id && (a.contentRevision || 0) === (asset.contentRevision || 0)))
            continue;
          renderer.seek(Math.min(0.35, renderer.duration / 3));
          applyLibrary(
            await window.shelf.update(asset.id, { ...renderer.metadata(), contentRevision: asset.contentRevision || 0 }),
          );
          applyLibrary(
            await window.shelf.thumbnail(asset.id, renderer.capture(), asset.contentRevision || 0),
          );
        } catch (error) {
          console.warn("Thumbnail unavailable", asset.name, error);
        } finally {
          renderer.dispose();
        }
      }
      generating.current = false;
    };
    void run();
  }, [loaded, thumbnailRevision, applyLibrary]);

  const updateAsset = useCallback(
    async (id: string, patch: Partial<Asset>) => {
      try {
        applyLibrary(await window.shelf.update(id, patch));
      } catch (e) {
        notify(String(e));
      }
    },
    [applyLibrary, notify],
  );
  const collection = library.collections.find((c) => c.id === section);
  const activeProject=library.projects.find(p=>`project:${p.id}`===section);
  const projectMembers=new Map(activeProject?.members.map(m=>[m.assetId,m]) || []);
  useEffect(()=>{
    if(activeProject && !activeProject.members.some(m=>m.assetId===selectedId))setSelectedId(activeProject.members[0]?.assetId || '');
  },[activeProject,selectedId]);
  const activeCategory = section.startsWith("category:")
    ? (section.slice(9) as Category)
    : null;
  const scopeAssets = useMemo(
    () =>
      library.assets.filter(
        (a) =>
          section === "all" ||
          (activeProject ? activeProject.members.some(m=>m.assetId===a.id) : activeCategory
            ? (a.category || "unclassified") === activeCategory
            : section === "favorites"
              ? a.favorite
              : section === "recent"
                ? Date.now() - new Date(a.importedAt).getTime() < 7 * 86400000
                : section === "ungrouped"
                  ? !a.collectionId
                  : a.collectionId === section),
      ),
    [library.assets, section, activeCategory,activeProject],
  );
  const assets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = scopeAssets.filter(
      (a) =>
        (!activeProject || projectCategory==='all' || activeProject.members.find(m=>m.assetId===a.id)?.categoryId===projectCategory) &&
        (format === "all" || a.format === format) &&
        (!query ||
          [a.name, ...a.tags, a.note, a.version, activeProject?.members.find(m=>m.assetId===a.id)?.label,activeProject?.members.find(m=>m.assetId===a.id)?.note]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
    return filtered.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : sort === "size"
          ? b.size - a.size
          : b.importedAt.localeCompare(a.importedAt),
    );
  }, [scopeAssets, search, format, sort,activeProject,projectCategory]);
  const selected = library.assets.find((a) => a.id === selectedId);
  const totalSize = library.assets.reduce((n, a) => n + a.size, 0);
  const title =
    (
      {
        all: "动画资源库",
        favorites: "我的收藏",
        recent: "最近导入",
        ungrouped: "未分组资源",
      } as Record<string, string>
    )[section] ||
    (activeCategory && CATEGORY_LABELS[activeCategory]) ||
    collection?.name ||
    activeProject?.name ||
    "动画资源库";
  const openImport = () => {
    setReport(null);
    setModal("import");
  };
  const handleReport = (result: ImportReport | null) => {
    if (!result) return;
    setReport(result);
    applyLibrary(result.library);
    setModal("import");
    if (result.added.length) setSelectedId(result.added[0]);
  };
  const importFiles = async (kind: "folder" | "files") => {
    setImporting(true);
    try {
      handleReport(await window.shelf.importDialog(kind, collection?.id));
    } catch (e) {
      notify(String(e));
    } finally {
      setImporting(false);
    }
  };
  const examples = async () => {
    setImporting(true);
    try {
      handleReport(await window.shelf.loadExamples());
    } catch (e) {
      notify(String(e));
    } finally {
      setImporting(false);
    }
  };
  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (importing || !window.shelf) return;
    const paths = window.shelf.getDroppedPaths(
      Array.from(event.dataTransfer.files),
    );
    if (!paths.length) return;
    setImporting(true);
    setReport(null);
    setModal("import");
    try {
      handleReport(await window.shelf.importPaths(paths, collection?.id));
    } catch (e) {
      notify(String(e));
    } finally {
      setImporting(false);
    }
  };
  const createCollection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!collectionName.trim()) return;
    try {
      const data = await window.shelf.collection(
        "create",
        undefined,
        collectionName,
      );
      applyLibrary(data);
      setSection(data.collections[data.collections.length - 1].id);
      setModal(null);
      setCollectionName("");
      notify("分组已创建，可在资源信息中将素材加入分组");
    } catch (e) {
      notify(String(e));
    }
  };
  const changeSection = (value: string) => {
    setSection(value);
    setSearch("");
    setProjectCategory('all');setBatch(false);setCheckedAssets([]);
  };
  const mutateProject=async(action:ProjectAction,input:ProjectInput)=>{
    const result=await window.shelf.projectMutate(action,input);applyLibrary(result.library);return result.projectId;
  };
  const exportProject=async(id:string,options:ProjectExportOptions)=>{
    setExporting(true);setExportProgress(null);
    try {const result=await window.shelf.projectExport(id,options);if(result)notify(`已导出 ${result.assets} 份素材${result.converted?`，已转换 ${result.converted} 份`:''}，${formatSize(result.bytes)}`);return !!result;}
    finally {setExporting(false);setExportProgress(null);}
  };
  const removeProjectMembers=async(ids:string[])=>{
    if(!activeProject)return;
    try{await mutateProject('removeMembers',{projectId:activeProject.id,assetIds:ids});setCheckedAssets([]);notify(`已从项目移出 ${ids.length} 份素材`);}catch(e){notify(String(e));}
  };
  const classifyAssets = async (id?: string) => {
    if (classifying) return;
    setClassifying(true);
    try {
      const result = await window.shelf.classify(id);
      applyLibrary(result.library);
      notify(
        id
          ? `已恢复自动分类：${CATEGORY_LABELS[result.library.assets.find((a) => a.id === id)!.category]}`
          : `已分类 ${result.classified} 份，待分类 ${result.unclassified} 份，保留手动分类 ${result.skipped} 份${result.errors.length ? `（${result.errors.length} 份文件不完整）` : ""}`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setClassifying(false);
    }
  };
  return (
    <div
      className={`app ${isMac ? "platform-mac" : "platform-windows"}`}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragCounter.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (--dragCounter.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <div className="titlebar">
        <div className="titlebar-brand">
          SPINE SHELF<span>动画有序，灵感自在</span>
        </div>
        <div className="titlebar-right">
          <span className="local-indicator" />
          本地工作空间
        </div>
      </div>
      <div className="app-body">
        <aside className="sidebar">
          <div className="brand">
            <img
              className="brand-icon"
              src="./brand/spine-shelf-logo.png"
              alt="Spine Shelf 标志"
              width={44}
              height={44}
              draggable={false}
            />
            <div>
              <strong>Spine Shelf</strong>
              <span>你的动画素材库</span>
            </div>
          </div>
          <div className="sidebar-scroll">
            <div className="nav-label">工作空间</div>
            <nav className="main-nav">
              <button
                className={section === "all" ? "active" : ""}
                onClick={() => changeSection("all")}
              >
                <LayoutGrid size={17} />
                <span>全部资源</span>
                <em>{library.assets.length}</em>
              </button>
              <button
                className={section === "favorites" ? "active" : ""}
                onClick={() => changeSection("favorites")}
              >
                <Star size={17} />
                <span>我的收藏</span>
                <em>{library.assets.filter((a) => a.favorite).length || ""}</em>
              </button>
              <button
                className={section === "recent" ? "active" : ""}
                onClick={() => changeSection("recent")}
              >
                <Clock3 size={17} />
                <span>最近导入</span>
              </button>
            </nav>
            <div className="nav-label collection-label">游戏项目<button className="icon-btn" aria-label="新建项目" data-tooltip="创建游戏素材项目" onClick={()=>setProjectDialog({mode:'create'})}><Plus size={15}/></button></div>
            <nav className="collection-nav project-nav" aria-label="游戏项目">
              {library.projects.map(p=><button key={p.id} aria-label={`项目：${p.name}`} className={activeProject?.id===p.id?'active':''} onClick={()=>changeSection(`project:${p.id}`)}><FolderOpen size={16}/><span>{p.name}</span><em>{p.members.length}</em></button>)}
              {!library.projects.length && <button className="new-collection" onClick={()=>setProjectDialog({mode:'create'})}><FolderPlus size={15}/>创建第一个项目</button>}
            </nav>
            <div className="nav-label collection-label">
              内容分类
              <button
                className="icon-btn"
                aria-label="重新自动分类"
                data-tooltip="重新分类全部资源，保留手动设置"
                disabled={classifying || importing || !library.assets.length}
                onClick={() => classifyAssets()}
              >
                {classifying ? (
                  <LoaderCircle className="spinning" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
              </button>
            </div>
            <nav className="main-nav category-nav" aria-label="内容分类导航">
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => {
                const Icon = categoryIcons[category];
                return (
                  <button
                    key={category}
                    aria-label={`分类：${CATEGORY_LABELS[category]}`}
                    className={activeCategory === category ? "active" : ""}
                    onClick={() => changeSection(`category:${category}`)}
                    title={
                      category === "material"
                        ? "边框、文字、按钮等普通素材"
                        : category === "unclassified"
                          ? "线索不足的素材，可手动设置类别"
                          : CATEGORY_LABELS[category]
                    }
                  >
                    <Icon size={16} />
                    <span>{CATEGORY_LABELS[category]}</span>
                    <em>
                      {
                        library.assets.filter(
                          (a) => (a.category || "unclassified") === category,
                        ).length
                      }
                    </em>
                  </button>
                );
              })}
            </nav>
            <div className="nav-label collection-label">
              自定义分组
              <button
                className="icon-btn"
                aria-label="新建分组"
                data-tooltip="新建资源分组"
                onClick={() => setModal("collection")}
              >
                <Plus size={15} />
              </button>
            </div>
            <nav className="collection-nav">
              <button
                className={section === "ungrouped" ? "active" : ""}
                onClick={() => changeSection("ungrouped")}
              >
                <Folder size={16} />
                <span>未分组</span>
                <em>{library.assets.filter((a) => !a.collectionId).length}</em>
              </button>
              {library.collections.map((c, index) => (
                <button
                  key={c.id}
                  className={section === c.id ? "active" : ""}
                  onClick={() => changeSection(c.id)}
                >
                  <Folder
                    size={16}
                    style={{
                      color: ["#b1a0e9", "#d9bb81", "#83babc"][index % 3],
                    }}
                  />
                  <span>{c.name}</span>
                  <em>
                    {
                      library.assets.filter((a) => a.collectionId === c.id)
                        .length
                    }
                  </em>
                </button>
              ))}
              <button
                className="new-collection"
                onClick={() => setModal("collection")}
              >
                <Plus size={15} />
                新建分组
              </button>
            </nav>
          </div>
          <div className="sidebar-bottom">
            <div className="local-card">
              <div>
                <HardDrive size={16} />
                <strong>安心保存在本地</strong>
                <span className="local-indicator" />
              </div>
              <p>素材随时在，灵感不掉线。</p>
              <div className="storage-line">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <footer>
                {formatSize(totalSize)}
                <span>{library.assets.length} 份资源</span>
              </footer>
            </div>
            <button
              className="sidebar-link"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} />
              资源库设置
            </button>
            <button className="sidebar-link" onClick={() => setModal("help")}>
              <HelpCircle size={16} />
              使用指南
              <ArrowRight size={13} />
            </button>
            <div className="version">
              SPINE SHELF <span>v{appVersion}</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <div className="main-topbar">
            <div className="breadcrumb">
              <LibraryBig size={14} />
              <span>工作空间</span>
              <ChevronRight size={13} />
              <b>{title}</b>
            </div>
            <button
              className="icon-btn"
              data-tooltip="打开使用指南和快捷键说明"
              aria-label="使用指南"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={17} />
            </button>
          </div>
          <div className={`workspace-heading${activeProject?' project-workspace-heading':''}`}>
            <div>
              <div className="eyebrow">YOUR ANIMATION COLLECTION</div>
              <h1>
                <b className="workspace-title" title={title}>{title}</b>
                <span>{scopeAssets.length}</span>
              </h1>
              <p>
                {activeProject ? activeProject.note || '挑选游戏素材，按用途整理后整包导出。' : activeCategory === "unclassified"
                  ? "内容线索不足的素材，可在资源信息中指定类别。"
                  : activeCategory === "material"
                    ? "边框、文字、按钮与其他界面素材。"
                    : activeCategory
                      ? "根据素材内容自动整理，支持随时手动调整。"
                      : "导入即分类，让每一份创作都有归处。"}
              </p>
            </div>
            {activeProject ? <div className="project-heading-actions">
              <button className="button" onClick={()=>setGenerating(true)}><Sparkles size={16}/>制作 Spine</button>
              <button className="button" onClick={()=>setProjectDialog({mode:'picker',projectId:activeProject.id})}><Plus size={16}/>添加素材</button>
              <button className="button primary" disabled={exporting || !activeProject.members.length} onClick={()=>setProjectDialog({mode:'export',projectId:activeProject.id})}><Download size={16}/>导出项目</button>
            </div> : <div className="project-heading-actions"><button className="button" onClick={()=>setGenerating(true)}><Sparkles size={16}/>制作 Spine</button><button
              className="button primary"
              onClick={openImport}
              disabled={importing}
            >
              <Plus size={17} />
              导入资源
            </button></div>}
          </div>
          {activeProject && <div className="project-overview">
            <div className="project-category-tabs" role="group" aria-label="项目分类筛选">
              <button aria-pressed={projectCategory==='all'} onClick={()=>setProjectCategory('all')}>全部 <b>{activeProject.members.length}</b></button>
              {activeProject.categories.map(c=><button key={c.id} aria-pressed={projectCategory===c.id} onClick={()=>setProjectCategory(c.id)}>{c.name}<b>{activeProject.members.filter(m=>m.categoryId===c.id).length}</b></button>)}
            </div>
            <button className="text-button" onClick={()=>setProjectDialog({mode:'settings',projectId:activeProject.id})}><Settings2 size={13}/>项目设置</button>
          </div>}
          <div className="library-toolbar">
            <div className="search-field">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="搜索资源"
                placeholder="搜索名称、标签或备注…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button
                  className="icon-btn"
                  aria-label="清空搜索"
                  onClick={() => setSearch("")}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd>{shortcutKey} K</kbd>
              )}
            </div>
            <div className="toolbar-select">
              <select
                aria-label="文件格式筛选"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                <option value="all">全部格式</option>
                <option value="json">JSON</option>
                <option value="skel">SKEL</option>
              </select>
              <ChevronDown size={13} />
            </div>
            <div className="view-toggle">
              <button
                aria-label="网格视图"
                className={view === "grid" ? "active" : ""}
                onClick={() => setView("grid")}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-label="列表视图"
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
              >
                <List size={17} />
              </button>
            </div>
          </div>
          <div className="library-subbar">
            <div>
              <span className="section-dot" />
              {search ? "搜索结果" : "全部素材"}
              <span className="muted">{assets.length} 份</span>
              <button className="text-button" onClick={()=>{setBatch(!batch);setCheckedAssets([]);}}>{batch?'退出多选':'批量选择'}</button>
              {collection && (
                <button
                  className="text-button"
                  onClick={() => setModal("removeCollection")}
                >
                  删除分组
                </button>
              )}
            </div>
            <div className="sort-control">
              <ArrowDownUp size={13} />
              <select
                aria-label="排序方式"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="recent">最近导入</option>
                <option value="name">名称排序</option>
                <option value="size">文件大小</option>
              </select>
              <ChevronDown size={12} />
            </div>
          </div>
          {batch && <div className="project-batch-bar"><span>已选 {checkedAssets.length} 份</span><button className="text-button" onClick={()=>setCheckedAssets(assets.map(a=>a.id))}>选择当前结果</button><button className="text-button" disabled={!checkedAssets.length} onClick={()=>setProjectDialog({mode:'assign',assetIds:checkedAssets})}>加入项目</button>{activeProject && <button className="text-button" disabled={!checkedAssets.length} onClick={()=>void removeProjectMembers(checkedAssets)}>移出项目</button>}</div>}
          <div className="library-scroll">
            {!loaded ? (
              <div className="empty-state">
                <LoaderCircle className="spinning" />
                <h3>正在打开资源库</h3>
              </div>
            ) : bootError ? (
              <div className="empty-state">
                <HardDrive size={36} />
                <h3>需要桌面环境</h3>
                <p>{bootError}</p>
              </div>
            ) : assets.length ? (
              <div
                className={`asset-grid ${view === "list" ? "list-view" : ""}`}
              >
                {assets.map((asset, index) => (
                  <article
                    role="button"
                    tabIndex={0}
                    aria-label={`预览 ${asset.name}`}
                    aria-pressed={selectedId === asset.id}
                    key={asset.id}
                    className={`asset-card ${selectedId === asset.id ? "selected" : ""} tint-${index % 4}`}
                    onClick={() => setSelectedId(asset.id)}
                    onKeyDown={(event) => {
                      if(event.target!==event.currentTarget)return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(asset.id);
                      }
                    }}
                  >
                    <div className="asset-image">
                      {asset.thumbnail ? (
                        <img
                          src={assetUrl(asset, "thumbnail.png")}
                          alt={asset.name}
                          loading="lazy"
                        />
                      ) : (
                        <div className="thumb-placeholder">
                          <FileBox size={40} strokeWidth={1} />
                          <span>生成缩略图中</span>
                        </div>
                      )}
                      <span className="version-pill">{asset.runtime}</span>
                      {batch && <label className="project-card-check" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`选择 ${asset.name}`} checked={checkedAssets.includes(asset.id)} onChange={e=>setCheckedAssets(e.target.checked?[...checkedAssets,asset.id]:checkedAssets.filter(id=>id!==asset.id))}/></label>}
                      <button
                        aria-label={`${asset.favorite ? "取消收藏" : "收藏"} ${asset.name}`}
                        className={`card-favorite ${asset.favorite ? "is-favorite" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateAsset(asset.id, { favorite: !asset.favorite });
                        }}
                      >
                        <Star
                          size={15}
                          fill={asset.favorite ? "currentColor" : "none"}
                        />
                      </button>
                      {selectedId === asset.id && (
                        <span className="preview-badge">
                          <span className="equalizer">
                            <i />
                            <i />
                            <i />
                          </span>
                          正在预览
                        </span>
                      )}
                    </div>
                    <div className="asset-card-info">
                      <div className="asset-name">
                        <h3 title={asset.name}>{projectMembers.get(asset.id)?.label || asset.name}</h3>
                        <span className="format-mini">
                          {asset.format.toUpperCase()}
                        </span>
                      </div>
                      <div className="asset-meta">
                        <span>
                          {asset.animations.length} 个动画
                          <span className="meta-dot">·</span>
                          {formatSize(asset.size)}
                        </span>
                        <span className="asset-labels">
                          <span
                            className={`category-tag category-${asset.category || "unclassified"}`}
                            title={(asset.categoryReasons || []).join("；")}
                          >
                            {CATEGORY_LABELS[asset.category || "unclassified"]}
                          </span>
                          {asset.demo && (
                            <span className="demo-label">演示</span>
                          )}
                        </span>
                      </div>
                      {view === "list" && (
                        <div className="list-tags">
                          {asset.tags.join(" · ") || "—"}
                        </div>
                      )}
                      <div className="project-card-footer">
                        {activeProject ? <>
                          <button className="text-button project-member-button" aria-label={`项目设置 ${asset.name}`} onClick={e=>{e.stopPropagation();setProjectDialog({mode:'member',projectId:activeProject.id,assetIds:[asset.id]});}} title="设置项目分类、名称和导出皮肤"><span>{activeProject.categories.find(c=>c.id===projectMembers.get(asset.id)?.categoryId)?.name}</span><span>{projectMembers.get(asset.id)?.skin}</span></button>
                          <button className="icon-btn" aria-label={`移出项目 ${asset.name}`} onClick={e=>{e.stopPropagation();void removeProjectMembers([asset.id]);}}><X size={13}/></button>
                        </> : <>
                          <button className="text-button" aria-label={`加入项目 ${asset.name}`} onClick={e=>{e.stopPropagation();setProjectDialog({mode:'assign',assetIds:[asset.id]});}}><FolderPlus size={13}/>加入项目</button>
                          <span className="project-used-count">{library.projects.filter(p=>p.members.some(m=>m.assetId===asset.id)).length || ''}{library.projects.some(p=>p.members.some(m=>m.assetId===asset.id))?' 个项目':''}</span>
                        </>}
                      </div>
                    </div>
                    {view === "list" && (
                      <ChevronRight size={15} className="list-arrow" />
                    )}
                  </article>
                ))}
                <button className="import-card" onClick={()=>activeProject?setProjectDialog({mode:'picker',projectId:activeProject.id}):openImport()}>
                  <span className="import-plus">
                    <Plus size={23} strokeWidth={1.5} />
                  </span>
                  <strong>{activeProject?'添加项目素材':'给灵感腾个位置'}</strong>
                  <span>{activeProject?'从资源库挑选人物、地形和其他素材':'导入文件夹，建立你的素材库'}</span>
                  <small>
                    {activeProject?'打开素材选择':'支持拖拽添加'} <ArrowRight size={12} />
                  </small>
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  {section === "favorites" ? (
                    <Star size={30} />
                  ) : search ? (
                    <Search size={30} />
                  ) : (
                    <FolderOpen size={30} />
                  )}
                </div>
                <h3>
                  {activeProject ? (projectCategory==='all'?'这个项目还没有素材':'这个分类还没有素材') : search || format !== "all"
                    ? "没有找到匹配的资源"
                    : section === "favorites"
                      ? "把喜欢的动画留在这里"
                      : "你的下一个灵感，从这里开始"}
                </h3>
                <p>
                  {activeProject ? '从资源库加入素材，再设置分类与导出皮肤。' : search || format !== "all"
                    ? "试试其他关键词，或清除筛选条件。"
                    : section === "favorites"
                      ? "点击资源卡片上的星标，就能随时找回。"
                      : collection
                        ? "导入素材到这个分组，或在资源信息中移动已有素材。"
                        : "将 Spine 文件夹拖进来，自动识别并保存。"}
                </p>
                {search || format !== "all" ? (
                  <button
                    className="button"
                    onClick={() => {
                      setSearch("");
                      setFormat("all");
                    }}
                  >
                    清除筛选
                  </button>
                ) : (
                  section !== "favorites" && (
                    <button className="button primary" onClick={()=>activeProject?setProjectDialog({mode:'picker',projectId:activeProject.id}):openImport()}>
                      <Plus size={16} />
                      {activeProject?'从资源库添加':'导入资源'}
                    </button>
                  )
                )}
              </div>
            )}
            {!!library.assets.length && (
              <div className="library-note">
                <Image size={14} />
                {activeProject?'项目引用资源库素材，可用于多个项目。':'导入后保留完整本地副本，可加入多个游戏项目。'}
              </div>
            )}
          </div>
          <footer className="main-footer">
            <span>
              <span className="local-indicator" />
              资源库已同步到本地
            </span>
            <span>
              {library.assets.length} 份资源<span className="meta-dot">·</span>
              {formatSize(totalSize)}
            </span>
          </footer>
        </main>
        <PreviewPane>
          {selected ? (
            <Viewer
              key={selected.id}
              asset={selected}
              library={library}
              onUpdate={updateAsset}
              onRemove={(asset) => {
                setRemoveTarget(asset);
                setModal("remove");
              }}
              notify={notify}
              onClassify={classifyAssets}
              classifying={classifying}
              preferredSkin={activeProject?.members.find(m=>m.assetId===selected.id)?.skin}
              onProject={(assetId,projectId)=>setProjectDialog({mode:projectId?'member':'assign',projectId,assetIds:[assetId]})}
            />
          ) : (
            <aside className="viewer-panel empty-preview">
              <div className="empty-preview-icon">
                <Box size={44} strokeWidth={1} />
              </div>
              <h3>让创作动起来</h3>
              <p>选择一份素材，即可预览动画。</p>
              <span>SPINE SHELF</span>
            </aside>
          )}
        </PreviewPane>
      </div>
      <Tooltips />
      {generationOpen&&<GenerationDialog close={()=>setGenerating(false)} view={id=>{setGenerating(false);setSection('all');setSearch('');setFormat('all');setSelectedId(id);}}/>}
      {projectDialog && <ProjectDialogs key={`${projectDialog.mode}:${projectDialog.projectId}:${projectDialog.assetIds?.join(',')}`} state={projectDialog} library={library} close={()=>setProjectDialog(null)} mutate={mutateProject} onCreated={id=>changeSection(id?`project:${id}`:'all')} onExport={exportProject} exportProgress={exportProgress}/>}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={46} />
            <h2>把灵感放进来</h2>
            <p>松开鼠标，自动识别文件夹中的 Spine 素材</p>
            <span>JSON / SKEL + ATLAS + 贴图</span>
          </div>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !importing)
              setModal(null);
          }}
        >
          <section
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon-btn"
              aria-label="关闭弹窗"
              disabled={importing}
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "import" && (
              <>
                <span className="modal-symbol">
                  <Upload size={23} />
                </span>
                <h2 id="modal-title">把动画加入你的资源库</h2>
                <p className="modal-description">
                  选择素材文件夹，自动配对文件并按内容分类。
                </p>
                {importing ? (
                  <div className="import-progress">
                    <LoaderCircle size={30} className="spinning" />
                    <h3>正在整理素材…</h3>
                    <p>识别文件、检查内容分类，并保存到本地资源库。</p>
                  </div>
                ) : report ? (
                  <>
                    <div className="import-summary">
                      <div>
                        <b>{report.added.length}</b>
                        <span>成功导入</span>
                      </div>
                      <div>
                        <b>{report.duplicates.length}</b>
                        <span>重复已跳过</span>
                      </div>
                      <div className={report.errors.length ? "has-errors" : ""}>
                        <b>{report.errors.length}</b>
                        <span>需要处理</span>
                      </div>
                    </div>
                    {report.added.length > 0 && (
                      <div className="classification-summary">
                        {(Object.keys(CATEGORY_LABELS) as Category[]).map(
                          (category) => {
                            const count = library.assets.filter(
                              (a) =>
                                report.added.includes(a.id) &&
                                a.category === category,
                            ).length;
                            return count ? (
                              <span key={category}>
                                {CATEGORY_LABELS[category]} {count}
                              </span>
                            ) : null;
                          },
                        )}
                      </div>
                    )}
                    {!!report.ignoredProjects?.length && (
                      <p className="import-note">
                        已略过 {report.ignoredProjects.length} 个配套工程文件，使用对应的 SKEL / JSON 预览。
                      </p>
                    )}
                    {report.errors.length > 0 && (
                      <div className="import-errors">
                        {report.errors.map((error, i) => (
                          <div key={i}>
                            <b>{error.file}</b>
                            {error.relativePath && error.relativePath !== error.file && (
                              <small className="import-error-path">{error.relativePath}</small>
                            )}
                            <p>{error.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="modal-actions">
                      <button
                        className="button"
                        onClick={() => setReport(null)}
                      >
                        继续导入
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setModal(null)}
                      >
                        查看资源库
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className="import-dropzone"
                      onClick={() => importFiles("folder")}
                    >
                      <div>
                        <FolderPlus size={32} strokeWidth={1.5} />
                      </div>
                      <h3>选择文件夹，或直接拖到这里</h3>
                      <p>支持多个素材、子文件夹和多张贴图</p>
                      <span>
                        选择素材文件夹 <ArrowRight size={14} />
                      </span>
                    </button>
                    <button
                      className="text-button import-file-link"
                      onClick={() => importFiles("files")}
                    >
                      也可以选择 JSON / SKEL 文件
                      <ChevronRight size={14} />
                    </button>
                    <div className="import-tip">
                      <Check size={15} />
                      <p>
                        导入后会保存完整副本，移动原文件不影响预览。
                        <br />
                        <span>
                          支持 Spine 3.6 / 3.8 / 4.0 / 4.1 / 4.2 / 4.3 导出素材。
                        </span>
                      </p>
                    </div>
                    <div className="demo-action">
                      <span>手头还没有素材？</span>
                      <button className="text-button" onClick={examples}>
                        <Sparkles size={14} />
                        加载官方演示
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {modal === "collection" && (
              <form onSubmit={createCollection}>
                <span className="modal-symbol">
                  <FolderPlus size={23} />
                </span>
                <h2 id="modal-title">给素材一个新分组</h2>
                <p className="modal-description">
                  按项目、角色或用途整理，让查找更简单。
                </p>
                <label className="field">
                  <span>分组名称</span>
                  <input
                    autoFocus
                    aria-label="分组名称"
                    placeholder="例如：我的游戏角色"
                    maxLength={50}
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={!collectionName.trim()}
                  >
                    创建分组
                  </button>
                </div>
              </form>
            )}
            {modal === "settings" && (
              <>
                <span className="modal-symbol">
                  <Settings2 size={23} />
                </span>
                <h2 id="modal-title">资源库设置</h2>
                <p className="modal-description">
                  你的创作，只保存在这台电脑上。
                </p>
                <div className="settings-row">
                  <span>本地存储</span>
                  <b>
                    {library.assets.length} 份资源 · {formatSize(totalSize)}
                  </b>
                </div>
                <label className="field">
                  <span>资源库位置</span>
                  <div className="path-box">{library.root}</div>
                </label>
                <button
                  className="button full-width"
                  onClick={() => window.shelf.reveal()}
                >
                  <FolderOpen size={16} />
                  {isMac ? "在访达中打开" : "在文件资源管理器中打开"}
                </button>
                <div className="settings-note">
                  <b>备份资源库</b>
                  <p>
                    退出应用后，复制整个 Library
                    文件夹即可备份；其中包含素材、缩略图、游戏项目、分组和收藏记录。
                  </p>
                </div>
                <div className="settings-row">
                  <span>本地运行库</span>
                  <b>3.6 · 3.8 · 4.0 · 4.1 · 4.2 · 4.3</b>
                </div>
                <div className="settings-row">
                  <span>应用版本</span>
                  <b>Spine Shelf {appVersion}</b>
                </div>
              </>
            )}
            {modal === "help" && (
              <>
                <span className="modal-symbol">
                  <HelpCircle size={23} />
                </span>
                <h2 id="modal-title">从文件夹，到动画资源库</h2>
                <div className="help-steps">
                  <div>
                    <b>01</b>
                    <section>
                      <h3>准备完整导出素材</h3>
                      <p>
                        文件夹中需要 .json 或 .skel 骨骼、.atlas
                        图集，以及图集使用的图片。.spine 是工程文件，需要先在
                        Spine 编辑器中导出。
                      </p>
                    </section>
                  </div>
                  <div>
                    <b>02</b>
                    <section>
                      <h3>一次导入，随时找到</h3>
                      <p>
                        点击「导入资源」或拖入文件夹。子文件夹会一起扫描，重复内容自动跳过。导入后保留完整副本。
                      </p>
                    </section>
                  </div>
                  <div>
                    <b>03</b>
                    <section>
                      <h3>挑选动作，查看细节</h3>
                      <p>
                        点击素材切换预览，选择动画和皮肤。可调整速度、逐帧定位、查看骨骼，并导出当前帧
                        PNG。拖动预览左边界调整宽度，双击复原；悬停图标查看功能说明。
                      </p>
                    </section>
                  </div>
                  <div>
                    <b>04</b>
                    <section>
                      <h3>建立自己的素材体系</h3>
                      <p>
                        用收藏、分组、标签和备注整理资源。名称、标签和备注都支持搜索，重启后自动保留。
                      </p>
                    </section>
                  </div>
                  <div>
                    <b>05</b>
                    <section>
                      <h3>整理游戏项目，整包导出</h3>
                      <p>从左侧「游戏项目」新建项目，批量添加素材，设置人物、地形等分类和导出皮肤。「导出项目」生成按分类保存的 ZIP，附资源清单。同一素材可以用于多个项目。</p>
                    </section>
                  </div>
                </div>
                <div className="shortcut-row">
                  <span>
                    <kbd>{shortcutKey} O</kbd> 导入
                  </span>
                  <span>
                    <kbd>{shortcutKey} K</kbd> 搜索
                  </span>
                  <span>
                    <kbd>空格</kbd> 播放
                  </span>
                  <span>
                    <kbd>F</kbd> 适应画布
                  </span>
                </div>
                <p className="license-note">
                  运行库与演示素材由 Esoteric Software 提供。随应用附带 Spine
                  Runtimes 许可文件，使用及分发须遵守对应许可。
                </p>
              </>
            )}
            {modal === "remove" && removeTarget && (
              <>
                <h2 id="modal-title">移除「{removeTarget.name}」？</h2>
                <p className="modal-description">
                  资源将从库中移除，原始导入文件不受影响。本地副本会暂存于资源库的
                  .trash 文件夹。
                </p>
                <div className="modal-actions">
                  <button className="button" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="button danger-button"
                    onClick={async () => {
                      try {
                        const data = await window.shelf.remove(removeTarget.id);
                        applyLibrary(data);
                        if (selectedId === removeTarget.id)
                          setSelectedId(data.assets[0]?.id || "");
                        setModal(null);
                        notify("已从资源库移除");
                      } catch (e) {
                        notify(String(e));
                      }
                    }}
                  >
                    移除资源
                  </button>
                </div>
              </>
            )}
            {modal === "removeCollection" && collection && (
              <>
                <h2 id="modal-title">删除分组「{collection.name}」？</h2>
                <p className="modal-description">
                  分组中的素材将移至「未分组」，所有素材仍保留在资源库中。
                </p>
                <div className="modal-actions">
                  <button className="button" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="button danger-button"
                    onClick={async () => {
                      try {
                        applyLibrary(
                          await window.shelf.collection(
                            "remove",
                            collection.id,
                          ),
                        );
                        setSection("all");
                        setModal(null);
                      } catch (e) {
                        notify(String(e));
                      }
                    }}
                  >
                    删除分组
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
