// Preload for the main app window (loads the web bridge origin). Desktop-only
// affordance surface: the web UI feature-detects window.cocDesktop and stays
// fully functional in a plain browser without it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cocDesktop", {
  openSettings: (opts) => ipcRenderer.invoke("app:openSettings", opts),
  // Model-dropdown curation from the 编辑模型 editor.
  getHiddenProviders: () => ipcRenderer.invoke("app:getHiddenProviders"),
  onHiddenProviders: (callback) => subscribe("app:hiddenProviders", callback),
  // Fired after a login or provider save writes models.json, so the model
  // dropdown can refetch instead of staying on the mount-time snapshot.
  onModelsChanged: (callback) => subscribe("app:modelsChanged", callback),
  // In-app fatal modal (bridge died / boot failure surfaced at runtime).
  onFatal: (callback) => subscribe("app:fatal", callback),
  restartBridge: () => ipcRenderer.invoke("app:restartBridge"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
});

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
