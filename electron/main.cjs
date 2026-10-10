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
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { Library } = require("./library.cjs");

app.setName("Spine Shelf");
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
let mainWindow, library;
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
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: "Spine Shelf",
    backgroundColor: "#111318",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 21 },
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
    handler(
      "library:import-dialog",
      async (kind, collectionId) => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title:
            kind === "files" ? "选择 Spine 骨骼文件" : "选择 Spine 素材文件夹",
          properties:
            kind === "files"
              ? ["openFile", "multiSelections"]
              : ["openDirectory", "multiSelections"],
          ...(kind === "files"
            ? {
                filters: [
                  {
                    name: "Spine 导出文件",
                    extensions: ["json", "skel", "bytes", "spine"],
                  },
                ],
              }
            : {}),
        });
        if (result.canceled) return null;
        return library.importPaths(result.filePaths, { collectionId });
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
      (id, data) => library.thumbnail(id, data),
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
        defaultPath: asset.name.replace(/[/\\:]/g, "-") + ".png",
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
          label: "Spine Shelf",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            { role: "quit" },
          ],
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
