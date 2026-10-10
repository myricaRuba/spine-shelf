const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("shelf", {
  platform: process.platform,
  getLibrary: () => ipcRenderer.invoke("library:get"),
  importDialog: (kind, collectionId) =>
    ipcRenderer.invoke("library:import-dialog", kind, collectionId),
  importPaths: (paths, collectionId) =>
    ipcRenderer.invoke("library:import-paths", paths, collectionId),
  getDroppedPaths: (files) =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  loadExamples: () => ipcRenderer.invoke("library:examples"),
  update: (id, patch) => ipcRenderer.invoke("library:update", id, patch),
  classify: (id) => ipcRenderer.invoke("library:classify", id),
  thumbnail: (id, data, revision) => ipcRenderer.invoke("library:thumbnail", id, data, revision),
  onLibraryChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("library:changed", listener);
    return () => ipcRenderer.removeListener("library:changed", listener);
  },
  onReskinChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("reskin:changed", listener);
    return () => ipcRenderer.removeListener("reskin:changed", listener);
  },
  reskinStatus: () => ipcRenderer.invoke("reskin:status"),
  reskinList: (assetId) => ipcRenderer.invoke("reskin:list", assetId),
  reskinDetails: (id) => ipcRenderer.invoke("reskin:details", id),
  reskinCreate: (input) => ipcRenderer.invoke("reskin:create", input),
  reskinStart: (id) => ipcRenderer.invoke("reskin:start", id),
  reskinCancel: (id) => ipcRenderer.invoke("reskin:cancel", id),
  reskinCopy: (id) => ipcRenderer.invoke("reskin:copy", id),
  reskinUpdate: (id, status) => ipcRenderer.invoke("reskin:update", id, status),
  remove: (id) => ipcRenderer.invoke("library:remove", id),
  collection: (action, id, name) =>
    ipcRenderer.invoke("library:collection", action, id, name),
  reveal: (id) => ipcRenderer.invoke("library:reveal", id),
  saveImage: (id, data) => ipcRenderer.invoke("image:save", id, data),
});
