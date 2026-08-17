// Preload for the main app window (loads the web bridge origin). Desktop-only
// affordance surface: the web UI feature-detects window.cocDesktop and stays
// fully functional in a plain browser without it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cocDesktop", {
  openSettings: (opts) => ipcRenderer.invoke("app:openSettings", opts),
  // In-app 编辑模型 overlay (same handlers as the settings window).
  getWizardState: () => ipcRenderer.invoke("wizard:getState"),
  saveProviderList: (payload) => ipcRenderer.invoke("wizard:saveProviderList", payload),
  saveProvider: (payload) => ipcRenderer.invoke("wizard:saveProvider", payload),
  loginProvider: (providerId, method) =>
    ipcRenderer.invoke("auth:login", { providerId, method }),
  respondPrompt: (promptId, value, cancel) =>
    ipcRenderer.invoke("auth:respond", { promptId, value, cancel }),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel"),
  openUrl: (url) => ipcRenderer.invoke("wizard:openUrl", url),
  onAuthEvent: (callback) => subscribe("auth:event", callback),
  onAuthPrompt: (callback) => subscribe("auth:prompt", callback),
  onAuthPromptDismissed: (callback) => subscribe("auth:promptDismissed", callback),
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
  // Native「导入 PDF 模组…」(menu / wizard): pushed when the bridge is live,
  // pulled once on mount for paths staged during first-run onboarding.
  onImportPdf: (callback) => subscribe("app:importPdf", callback),
  consumePdfImport: () => ipcRenderer.invoke("app:consumePdfImport"),
});

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
