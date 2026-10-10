const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("shelf", {
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
  thumbnail: (id, data) => ipcRenderer.invoke("library:thumbnail", id, data),
  remove: (id) => ipcRenderer.invoke("library:remove", id),
  collection: (action, id, name) =>
    ipcRenderer.invoke("library:collection", action, id, name),
  reveal: (id) => ipcRenderer.invoke("library:reveal", id),
  saveImage: (id, data) => ipcRenderer.invoke("image:save", id, data),
});
