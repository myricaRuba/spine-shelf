const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  shell,
  Menu,
  session,
  clipboard,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { Library } = require("./library.cjs");
const { ReskinService } = require("./reskin.cjs");
const { startReskinBridge } = require("./reskin-bridge.cjs");
const { CodexRunner } = require("./codex-runner.cjs");
const { GenerationService } = require("./generation.cjs");
const { ProjectService, filename } = require("./projects.cjs");
const { SpineConverter } = require('./spine-converter.cjs');

app.setName("Spine Shelf");
const isMac = process.platform === "darwin";
if (process.platform === "win32")
  app.setAppUserModelId("studio.spineshelf.desktop");
if (process.env.SPINE_SHELF_DATA)
  app.setPath("userData", process.env.SPINE_SHELF_DATA);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "shelf",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let mainWindow, library, reskins, reskinBridge, codexRunner, projects, generation, generationRunner;
let queue = Promise.resolve();
const enqueue = (task) => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
function handler(name, fn, mutates = false) {
  ipcMain.handle(name, (event, ...args) => {
    const url = event.senderFrame?.url || "";
    if (
      event.sender !== mainWindow?.webContents ||
      !(
        url.startsWith("shelf://app/") ||
        (process.env.VITE_DEV_SERVER_URL &&
          url.startsWith(process.env.VITE_DEV_SERVER_URL + "/"))
      )
    )
      throw new Error("请求来源无效。");
    return mutates ? enqueue(() => fn(...args)) : fn(...args);
  });
}
async function seedExamples() {
  const examples = app.isPackaged
    ? path.join(process.resourcesPath, "examples")
    : path.join(__dirname, "../resources/examples");
  return library.importPaths([examples], { demo: true });
}
async function selectImportPaths(kind, projectName) {
  if (!['files', 'folder'].includes(kind)) throw new Error('请选择文件或文件夹导入。');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: projectName ? `导入资源到「${projectName}」` : kind === 'files' ? '选择 Spine 骨骼文件' : '选择 Spine 素材文件夹',
    properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'],
    ...(kind === 'files' ? { filters: [{ name: 'Spine 导出文件', extensions: ['json', 'skel', 'bytes', 'spine'] }] } : {}),
  });
  return result.canceled || !result.filePaths.length ? null : result.filePaths;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: "Spine Shelf",
    backgroundColor: "#111318",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 20, y: 21 },
        }
      : {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#17191e",
            symbolColor: "#b5bac1",
            height: 54,
          },
          autoHideMenuBar: true,
          icon: app.isPackaged
            ? path.join(process.resourcesPath, "icon.ico")
            : path.join(__dirname, "../resources/icon.ico"),
        }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL || "shelf://app/index.html",
  );
}
app
  .whenReady()
  .then(async () => {
    library = new Library(path.join(app.getPath("userData"), "Library"));
    await library.init();
    const spineConverter = new SpineConverter({settingsFile:path.join(app.getPath('userData'),'spine-converter.json')});
    await spineConverter.init();
    projects = new ProjectService(library,spineConverter);
    reskins = new ReskinService(library, (libraryChanged) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (libraryChanged) mainWindow.webContents.send("library:changed", library.snapshot());
        mainWindow.webContents.send("reskin:changed");
      }
    });
    await reskins.init();
    codexRunner = new CodexRunner({service:reskins,enqueue,userData:app.getPath("userData")});
    await codexRunner.init();
    generation = new GenerationService(library,(libraryChanged)=>{
      if(mainWindow&&!mainWindow.isDestroyed()) {
        if(libraryChanged)mainWindow.webContents.send('library:changed',library.snapshot());
        mainWindow.webContents.send('reskin:changed');
      }
    });
    await generation.init();
    generationRunner = new CodexRunner({service:generation,enqueue,userData:app.getPath('userData')});
    await generationRunner.init();
    reskinBridge = await startReskinBridge({ service: reskins, generation, userData: app.getPath("userData"), enqueue });
    if (!library.data.seeded) {
      await seedExamples();
      library.data.seeded = true;
      await library.save();
    }
    protocol.handle("shelf", async (request) => {
      try {
        const url = new URL(request.url);
        let base, relative;
        if (url.host === "app") {
          base = path.join(__dirname, "../dist");
          relative = decodeURIComponent(url.pathname);
        } else if (url.host === "asset") {
          const parts = url.pathname
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent);
          library.asset(parts[0]);
          base = path.join(library.root, "assets", parts.shift());
          relative = parts.join("/");
        } else return new Response("Not found", { status: 404 });
        const target = path.resolve(
          base,
          "." + path.sep + relative.replace(/^\/+/, ""),
        );
        if (!target.startsWith(base + path.sep))
          return new Response("Forbidden", { status: 403 });
        const response = await net.fetch(pathToFileURL(target).href);
        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "no-cache");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    handler("library:get", () => library.snapshot());
    handler("project:mutate", (action,input) => projects.mutate(action,input),true);
    handler('project:import-dialog', async (id, kind) => {
      const project = projects.project(id);
      const paths = await selectImportPaths(kind, project.name);
      return paths ? enqueue(() => projects.importPaths(id, paths)) : null;
    });
    handler('project:import-paths', (id, paths) => projects.importPaths(id, paths), true);
    handler('project:export-plan', (id,options) => projects.exportPlan(id,options));
    handler('project:spine-select', async () => {
      const selection=await dialog.showOpenDialog(mainWindow,{title:'选择 Spine 命令行程序',properties:['openFile'],...(process.platform==='win32'?{filters:[{name:'Spine 程序',extensions:['com','exe']}]}:{})});
      if(selection.canceled || !selection.filePaths[0])return null;
      return spineConverter.configure(selection.filePaths[0]);
    });
    handler("project:export", async (id,options={}) => {
      const project=projects.project(id);
      if(!project.members.length)throw new Error('项目里还没有素材，请先从资源库添加。');
      const plan=await projects.exportPlan(id,options);
      if(!plan.assets.length)throw new Error('请至少选择一份需要导出的素材。');
      if(!plan.canExport)throw new Error(plan.assets.find(a=>a.action==='blocked')?.message || plan.converter.message);
      const destination=await dialog.showSaveDialog(mainWindow,{title:'导出项目素材包',defaultPath:filename(project.name)+'.zip',filters:[{name:'ZIP 素材包',extensions:['zip']}]});
      if(destination.canceled || !destination.filePath)return null;
      const result=await enqueue(()=>projects.export(id,destination.filePath,p=> {
        if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('project:export-progress',{projectId:id,...p});
      },options));
      shell.showItemInFolder(result.path);return result;
    });
    handler("reskin:status", async () => ({...reskinBridge.status(),codex:await codexRunner.status()}));
    handler("reskin:list", (assetId) => reskins.list({ assetId }));
    handler("reskin:capabilities", () => ({ manageSkins: true }));
    handler("reskin:remove", (assetId, name, expectedTaskId) => reskins.remove(assetId, name, expectedTaskId), true);
    handler("reskin:details", (id) => codexRunner.details(id), true);
    handler("reskin:create", async (input) => {
      const status=await codexRunner.status(true);
      if(!status.ready)throw new Error(status.message);
      const result=await enqueue(()=>reskins.create(input));
      await codexRunner.start(result.job.id);
      return result;
    });
    handler("reskin:start", (id) => codexRunner.start(id));
    handler("reskin:cancel", (id) => codexRunner.cancel(id));
    handler("reskin:update", (id, status) => {
      if (!["queued", "cancelled"].includes(status)) throw new Error("任务状态无效。");
      return reskins.update(id, status);
    }, true);
    handler("reskin:copy", (id) => clipboard.writeText(reskins.handoff(id)));
    handler('generation:list',()=>generation.list());
    handler('generation:capabilities',()=>({actionTable:true,rigVersion:2}));
    handler('generation:details',id=>generationRunner.details(id),true);
    handler('generation:create',async input=>{
      const status=await generationRunner.status(true);
      if(!status.ready)throw new Error(status.message);
      const result=await enqueue(()=>generation.create(input));
      await generationRunner.start(result.job.id);return result;
    });
    handler('generation:start',id=>generationRunner.start(id));
    handler('generation:cancel',id=>generationRunner.cancel(id));
    handler(
      "library:import-dialog",
      async (kind, collectionId) => {
        const paths = await selectImportPaths(kind);
        return paths ? library.importPaths(paths, { collectionId }) : null;
      },
      true,
    );
    handler(
      "library:import-paths",
      (paths, collectionId) => library.importPaths(paths, { collectionId }),
      true,
    );
    handler("library:examples", () => seedExamples(), true);
    handler("library:update", (id, patch) => library.update(id, patch), true);
    handler("library:classify", (id) => library.classifyLibrary(id), true);
    handler(
      "library:thumbnail",
      (id, data, revision) => library.thumbnail(id, data, revision),
      true,
    );
    handler("library:remove", (id) => library.remove(id), true);
    handler(
      "library:collection",
      (action, id, name) => library.collection(action, id, name),
      true,
    );
    handler("library:reveal", async (id) => {
      if (id) {
        library.asset(id);
        shell.showItemInFolder(
          path.join(library.root, "assets", id, "texture.atlas"),
        );
      } else await shell.openPath(library.root);
    });
    handler("image:save", async (id, data) => {
      const asset = library.asset(id);
      if (
        typeof data !== "string" ||
        !data.startsWith("data:image/png;base64,") ||
        data.length > 40000000
      )
        throw new Error("截图无效。");
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: asset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") + ".png",
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (result.canceled) return false;
      await fs.writeFile(
        result.filePath,
        Buffer.from(data.split(",")[1], "base64"),
      );
      return true;
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: isMac ? "Spine Shelf" : "文件",
          submenu: isMac ? [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            { role: "quit" },
          ] : [{ role: "about" }, { type: "separator" }, { role: "quit" }],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "视图",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "窗口",
          submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
        },
      ]),
    );
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Spine Shelf 启动失败", error.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.SPINE_SHELF_TEST) app.quit();
});
let finishing = false;
app.on("before-quit", (event) => {
  if (finishing) return;
  event.preventDefault(); finishing = true;
  (async () => {
    await codexRunner?.shutdown();
    await generationRunner?.shutdown();
    await queue;
    await reskinBridge?.close();
    app.quit();
  })().catch(error => { console.error(error.message); app.exit(1); });
});
